require('dotenv').config();
console.log('Environment Loaded. GATEWAY:', process.env.ENABLE_GATEWAY_ENCRYPTION);
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cloudinary = require('./utils/cloudinary');
const upload = require('./middleware/upload');
const { encryptMessage, decryptMessage, generateRoomToken, verifyRoomToken } = require('./utils/security');
const { randomUUID } = require('crypto');

// Models
const ChatUser = require('./models/ChatUser');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // In production, restrict this to specific domains
});

// --- DB Connection ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/picloopz-chat')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// --- Rate Limiter (Simple In-Memory) ---
const rateLimits = new Map();
const LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 20; // 20 messages per minute

function checkRateLimit(socketId) {
  const now = Date.now();
  const userLimit = rateLimits.get(socketId) || { count: 0, start: now };

  if (now - userLimit.start > LIMIT_WINDOW) {
    userLimit.count = 0;
    userLimit.start = now;
  }

  userLimit.count++;
  rateLimits.set(socketId, userLimit);
  return userLimit.count <= MAX_REQUESTS;
}

// --- REST APIs ---

// 0. Get Auth Token (Client calls this first)
app.post('/api/chat/token', (req, res) => {
  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ error: 'UserId required' });

  const token = generateRoomToken(userId, role || 'user');
  res.json({ token });
});

// 1. Upload
app.post('/api/chat/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Validate mime type/size logic handled by multer middleware usually, 
    // but we can add extra checks here if needed.

    // Upload to Cloudinary (Authenticated)
    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'auto',
      folder: 'picloopz_chat',
      type: 'authenticated'
    });

    // Generate Signed URL
    const signedUrl = cloudinary.url(result.public_id, {
      resource_type: result.resource_type,
      type: 'authenticated',
      sign_url: true,
      secure: true,
      version: result.version // explicit version often helps with caching
    });

    res.json({ url: signedUrl, type: result.resource_type });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 2. Get Conversations (Admin Sidebar)
app.get('/api/chat/conversations', async (req, res) => {
  try {
    // This endpoint should ideally be protected by admin token too
    const convos = await Conversation.find().sort({ updatedAt: -1 });

    const populated = await Promise.all(convos.map(async (c) => {
      const user = await ChatUser.findOne({ userId: c.userId });

      // Decrypt last message preview
      let lastMsg = c.lastMessage;
      if (lastMsg && lastMsg.content) {
        lastMsg.content = decryptMessage(lastMsg.content);
      }
      return { ...c.toObject(), user, lastMessage: lastMsg };
    }));

    const validConvos = populated.filter(c => c.user);
    res.json(validConvos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Get History
app.get('/api/chat/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }]
    }).sort({ createdAt: 1 });

    // Decrypt messages
    const decryptedKeys = messages.map(m => {
      const doc = m.toObject();
      doc.content = decryptMessage(doc.content);
      return doc;
    });

    res.json(decryptedKeys);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Mark Read
app.post('/api/chat/read/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await Message.updateMany(
      { senderId: userId, receiverId: 'admin', isRead: false },
      { $set: { isRead: true } }
    );
    await Conversation.findOneAndUpdate(
      { userId: userId },
      { $set: { unreadCount: 0 } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Socket.IO Middleware ---

// ...
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));

  const decoded = verifyRoomToken(token);
  if (!decoded) {
    console.log('[Auth Failure] Token verification failed:', token);
    return next(new Error('Invalid or expired token'));
  }

  socket.user = decoded; // { uid, role, ts }
  next();
});

const { attachGateway, attachServerGateway } = require('./gateway/chatGateway');

// --- Gateway Init ---
attachServerGateway(io);

// --- Socket.IO Logic ---
io.on('connection', async (socket) => {
  const { uid, role } = socket.user;
  console.log(`Socket connected: ${uid} (${role})`);

  // Attach Encryption Gateway
  attachGateway(socket);

  // Room Assignment
  if (role === 'admin') {
    socket.join('admin_room');
    console.log('Joined admin_room');
  } else {
    // User: Find or Create unique room
    let convo = await Conversation.findOne({ userId: uid });
    let roomId;

    if (convo) {
      if (!convo.roomId) {
        // Migration: Add roomId if missing
        roomId = `conv_${randomUUID()}`;
        convo.roomId = roomId;
        await convo.save();
      } else {
        roomId = convo.roomId;
      }
    } else {
      roomId = `conv_${randomUUID()}`;
      convo = await Conversation.create({
        userId: uid,
        roomId: roomId,
        participants: [uid, 'admin']
      });
    }

    socket.join(roomId);
    socket.activeRoomId = roomId; // Cache on socket

    // Update Online Status
    await ChatUser.findOneAndUpdate(
      { userId: uid },
      { isOnline: true, lastSeen: new Date() },
      { upsert: true }
    );
    io.to('admin_room').emit('user_status', { userId: uid, isOnline: true });
  }

  // 1. Identify User (Legacy/Metadata update)
  socket.on('identify_user', async (userData) => {
    // Just update metadata, trust socket.user.uid
    if (userData.userId !== uid) return; // Prevent spoofing

    await ChatUser.findOneAndUpdate(
      { userId: uid },
      { name: userData.name, email: userData.email, avatar: userData.avatar, isOnline: true },
      { upsert: true, new: true }
    );
  });

  // 2. Identify Admin (No-op now, handled by token)
  socket.on('identify_admin', () => { /* handled in connection */ });

  // 3. Send Message
  socket.on('send_message', async (data) => {
    // Rate Limit
    if (!checkRateLimit(socket.id)) {
      return socket.emit('error', 'Rate limit exceeded');
    }

    // Size Limit (5KB for text)
    if (data.type === 'text' && data.content && data.content.length > 5000) {
      return socket.emit('error', 'Message too long');
    }

    // data: { receiverId, content, type, fileUrl, clientId }
    // Sender is ALWAYS socket.user.uid
    const senderId = uid;
    const receiverId = data.receiverId;

    // Validate participants
    if (role === 'user' && receiverId !== 'admin') return; // Users only talk to admin
    // Admins can talk to anyone

    try {
      // Encrypt Content
      const encryptedContent = encryptMessage(data.content);

      // Save Message
      const newMessage = await Message.create({
        senderId,
        receiverId,
        content: encryptedContent,
        type: data.type,
        fileUrl: data.fileUrl,
        clientId: data.clientId
      });

      console.log(`[SECURE] Message saved. Encrypted content in DB: ${encryptedContent.substring(0, 30)}...`);

      // Prepare Decrypted Message for Emitting
      const emittedMessage = {
        ...newMessage.toObject(),
        content: data.content // Send back plain text to active sockets
      };

      // Find Conversation to update
      const targetUserId = senderId === 'admin' ? receiverId : senderId;

      const updateData = {
        userId: targetUserId,
        participants: [targetUserId, 'admin'],
        lastMessage: { content: encryptedContent, type: data.type, createdAt: new Date() },
        updatedAt: new Date(),
      };

      const inc = senderId === 'admin' ? {} : { unreadCount: 1 };

      const updatedConvo = await Conversation.findOneAndUpdate(
        { userId: targetUserId },
        { $set: updateData, $inc: inc },
        { upsert: true, new: true }
      );

      // Determine Room to Emit to
      let targetRoom;
      if (receiverId === 'admin') {
        targetRoom = 'admin_room';
      } else {
        // If admin sending to user, need user's room
        const receiverConvo = await Conversation.findOne({ userId: receiverId });
        targetRoom = receiverConvo ? receiverConvo.roomId : null;
      }

      // Emit to Receiver
      if (targetRoom) {
        io.to(targetRoom).emit('receive_message', emittedMessage);
      }

      // Emit back to Sender (if not in same room)
      // If user sends to admin: user is in conv_X, admin is in admin_room. 
      // User needs to see it? Yes.
      // Admin needs to see it? Yes.
      // If we emit to admin_room, admin sees.
      // If we emit to conv_X, user sees.

      if (senderId !== 'admin') {
        // User sent. User is in conv_X. emits receive_message to admin_room.
        // Also emit to conv_X so user sees it/acks it? 
        // Or just rely on client optimism? Client usually appends optimistic.
        // But let's emit to sender room for consistency (e.g. valid ID).
        if (socket.activeRoomId) io.to(socket.activeRoomId).emit('receive_message', emittedMessage);
      } else {
        // Admin sent. Admin in admin_room. Receiver in conv_X.
        // Emit to conv_X (receiver).
        // Emit to admin_room (so other admins see it).
        io.to('admin_room').emit('receive_message', emittedMessage);
      }

      // Update Admin Sidebar
      const userDetails = await ChatUser.findOne({ userId: targetUserId });
      // Describe last message decrypted
      const convoObj = updatedConvo.toObject();
      if (convoObj.lastMessage) convoObj.lastMessage.content = data.content;

      io.to('admin_room').emit('chat_list_update', { ...convoObj, user: userDetails });

    } catch (e) {
      console.error('Message handling error:', e);
    }
  });

  // 4. Delete Message
  socket.on('delete_message', async ({ messageId }) => {
    // implementation omitted for brevity, similar logic but check ownership
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;

      if (msg.senderId !== uid && role !== 'admin') return;

      msg.isDeleted = true;
      msg.content = encryptMessage("This message was deleted");
      await msg.save();

      // Notify
      io.to('admin_room').emit('message_deleted', { messageId });

      // Notify user room
      if (msg.senderId !== 'admin') {
        // Sender was user, find their room
        const c = await Conversation.findOne({ userId: msg.senderId });
        if (c) io.to(c.roomId).emit('message_deleted', { messageId });
      } else {
        // Sender was admin, receiver was user
        const c = await Conversation.findOne({ userId: msg.receiverId });
        if (c) io.to(c.roomId).emit('message_deleted', { messageId });
      }

    } catch (e) {
      console.error('Delete error:', e);
    }
  });

  socket.on('disconnect', async () => {
    if (role !== 'admin') {
      console.log(`User disconnected: ${uid}`);
      await ChatUser.findOneAndUpdate({ userId: uid }, { isOnline: false, lastSeen: new Date() });
      io.to('admin_room').emit('user_status', { userId: uid, isOnline: false });
    }
  });
});

// --- Health Check & Keep-Alive ---
app.get('/health', (req, res) => res.send('OK'));

// Self-ping to keep Render free tier awake (every 14 mins)
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://chat-feature-picloopz-backend.onrender.com'; // Update with actual Render URL if different
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    http.get(`${RENDER_EXTERNAL_URL}/health`, (resp) => {
      console.log(`[Keep-Alive] Ping sent. Status: ${resp.statusCode}`);
    }).on('error', (err) => {
      console.error('[Keep-Alive] Ping failed:', err.message);
    });
  }, 14 * 60 * 1000); // 14 minutes
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Chat Backend running on port ${PORT}`));

