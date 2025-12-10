require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cloudinary = require('./utils/cloudinary');
const upload = require('./middleware/upload');

// Models
const ChatUser = require('./models/ChatUser');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // Allow all for now
});

// --- DB Connection ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/picloopz-chat')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// --- REST APIs ---

// 1. Upload
app.post('/api/chat/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'auto',
      folder: 'picloopz_chat'
    });

    res.json({ url: result.secure_url, type: result.resource_type });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 2. Get Conversations (Admin Sidebar)
app.get('/api/chat/conversations', async (req, res) => {
  try {
    // Fetch conversations sorted by last updated
    const convos = await Conversation.find().sort({ updatedAt: -1 });

    // Enrich with user details from ChatUser collection
    const populated = await Promise.all(convos.map(async (c) => {
      const user = await ChatUser.findOne({ userId: c.userId });
      return { ...c.toObject(), user };
    }));

    // Filter out conversations with unknown users
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
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Mark Read (Admin opens chat)
app.post('/api/chat/read/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    // Update messages sent by user to admin as read
    await Message.updateMany(
      { senderId: userId, receiverId: 'admin', isRead: false },
      { $set: { isRead: true } }
    );
    // Reset unread count in conversation
    await Conversation.findOneAndUpdate(
      { userId: userId },
      { $set: { unreadCount: 0 } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Socket.IO Logic ---

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // 1. Identify User
  socket.on('identify_user', async (userData) => {
    const { userId, name, email, avatar } = userData;
    if (!userId) return;

    socket.userId = userId;
    socket.role = 'user';
    socket.join(`room_${userId}`);

    console.log(`User identified: ${userId} (${name})`);

    // Update/Create User
    try {
      await ChatUser.findOneAndUpdate(
        { userId },
        { name, email, avatar, isOnline: true, lastSeen: new Date() },
        { upsert: true, new: true }
      );

      // Notify Admin
      io.to('admin_room').emit('user_status', { userId, isOnline: true });
    } catch (e) {
      console.error('Error updating ChatUser:', e);
    }
  });

  // 2. Identify Admin
  socket.on('identify_admin', () => {
    console.log('Admin identified');
    socket.role = 'admin';
    socket.join('admin_room');
  });

  // 3. Send Message
  socket.on('send_message', async (data) => {
    // data: { senderId, receiverId, content, type, fileUrl }
    const { senderId, receiverId, content, type, fileUrl } = data;

    try {
      // Save Message
      const newMessage = await Message.create({
        senderId, receiverId, content, type, fileUrl, clientId: data.clientId
      });

      // Update Conversation
      const targetUserId = senderId === 'admin' ? receiverId : senderId;

      const updateData = {
        userId: targetUserId,
        participants: [targetUserId, 'admin'],
        lastMessage: { content: type === 'text' ? content : 'Attachment', type, createdAt: new Date() },
        updatedAt: new Date(),
      };

      // Increment unread count if user sent it (Admin hasn't read it yet)
      // If admin sent it, we don't increment user's unread count on the conversation model 
      // (usually user unread count is calculated differently or we can add a field for it if needed, 
      // but for now we focus on Admin's unread count)
      const inc = senderId === 'admin' ? {} : { unreadCount: 1 };

      const updatedConvo = await Conversation.findOneAndUpdate(
        { userId: targetUserId },
        {
          $set: updateData,
          $inc: inc
        },
        { upsert: true, new: true }
      );

      // Emit to Receiver
      const room = receiverId === 'admin' ? 'admin_room' : `room_${receiverId}`;
      io.to(room).emit('receive_message', newMessage);

      // Emit back to Sender (for confirmation/sync)
      // If sender is admin, they are in admin_room, so they might get it twice if we are not careful.
      // But usually we append locally.
      // Let's emit to the specific socket just in case or rely on the room emit if the sender is also in the room.
      // Admin is in admin_room, so admin receives their own message via 'receive_message' above.
      // User is in room_userId, so user receives their own message via 'receive_message' above? 
      // Wait, if user sends to admin, receiver is admin. Room is admin_room. User is NOT in admin_room.
      // So User needs a confirmation or we just emit to room_senderId as well.

      if (senderId !== 'admin') {
        io.to(`room_${senderId}`).emit('receive_message', newMessage);
      } else {
        // Admin sent to user. Receiver is user. Room is room_user.
        // Admin needs to see the message too.
        io.to('admin_room').emit('receive_message', newMessage);
      }

      // If user sent to admin, update admin's sidebar list
      if (receiverId === 'admin') {
        const userDetails = await ChatUser.findOne({ userId: senderId });
        io.to('admin_room').emit('chat_list_update', { ...updatedConvo.toObject(), user: userDetails });
      } else {
        // Admin sent to user. Also update admin's sidebar to show latest message
        const userDetails = await ChatUser.findOne({ userId: receiverId });
        io.to('admin_room').emit('chat_list_update', { ...updatedConvo.toObject(), user: userDetails });
      }

    } catch (e) {
      console.error('Message handling error:', e);
    }
  });

  // 4. Delete Message
  socket.on('delete_message', async ({ messageId, userId }) => {
    try {
      // Find message
      const msg = await Message.findById(messageId);
      if (!msg) return;

      // Check ownership (or if admin)
      // Allow if senderId matches or if requester is admin
      if (msg.senderId !== userId && socket.role !== 'admin') {
        // You might want to allow admin to delete any message
        // But if socket.userId is not set correctly for admin? 
        // Admin socket role is 'admin'.
        // If the user trying to delete is the sender, allow it.
        return;
      }

      // Soft delete
      msg.isDeleted = true;
      await msg.save();

      // Emit to everyone involved
      // Notify sender room
      io.to(`room_${msg.senderId}`).emit('message_deleted', { messageId, conversationId: msg.conversationId });
      // Notify receiver room
      if (msg.receiverId === 'admin') {
        io.to('admin_room').emit('message_deleted', { messageId, conversationId: msg.conversationId });
      } else {
        io.to(`room_${msg.receiverId}`).emit('message_deleted', { messageId, conversationId: msg.conversationId });
      }

      // Also if admin deleted a user message, we need to ensure both sides get it.
      if (msg.receiverId !== 'admin') {
        // If receiver is user, notify admin too (sender was admin)
        io.to('admin_room').emit('message_deleted', { messageId, conversationId: msg.conversationId });
      }
      if (msg.senderId !== 'admin') {
        // If sender was user, we already notified room_senderId. 
        // If receiver was admin, we notified admin_room.
      }

    } catch (e) {
      console.error('Delete message error:', e);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.userId) {
      console.log(`User disconnected: ${socket.userId}`);
      await ChatUser.findOneAndUpdate({ userId: socket.userId }, { isOnline: false, lastSeen: new Date() });
      io.to('admin_room').emit('user_status', { userId: socket.userId, isOnline: false });
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Chat Backend running on port ${PORT}`));
