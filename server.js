require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cloudinary = require('./utils/cloudinary');
const upload = require('./middleware/upload');
const { encrypt, decrypt, encryptObject, decryptObject } = require('./utils/crypto');

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

// 5. Gateway Route with Crypto Encryption
app.post('/gateway', async (req, res) => {
  try {
    const { action, data, encryptedData } = req.body;

    // If encryptedData is provided, decrypt it first
    let decryptedData = null;
    if (encryptedData) {
      try {
        decryptedData = decryptObject(encryptedData);
      } catch (e) {
        return res.status(400).json({ 
          error: 'Invalid encrypted data', 
          details: e.message 
        });
      }
    }

    // Process based on action
    let result = null;
    
    switch (action) {
      case 'encrypt':
        // Encrypt the provided data
        if (!data) {
          return res.status(400).json({ error: 'Data is required for encryption' });
        }
        const encrypted = encryptObject(data);
        result = { 
          success: true, 
          encryptedData: encrypted,
          message: 'Data encrypted successfully'
        };
        break;

      case 'decrypt':
        // Decrypt the provided encrypted data
        if (!encryptedData && !data) {
          return res.status(400).json({ error: 'Encrypted data is required for decryption' });
        }
        const dataToDecrypt = encryptedData || data;
        try {
          const decrypted = decryptObject(dataToDecrypt);
          result = { 
            success: true, 
            decryptedData: decrypted,
            message: 'Data decrypted successfully'
          };
        } catch (e) {
          return res.status(400).json({ 
            error: 'Decryption failed', 
            details: e.message 
          });
        }
        break;

      case 'process':
        // Process decrypted data (example: save to database, etc.)
        if (!decryptedData && !data) {
          return res.status(400).json({ error: 'Data is required for processing' });
        }
        const processData = decryptedData || data;
        
        // Example: Save encrypted message
        if (processData.type === 'message' && processData.content) {
          const { senderId, receiverId, content, type, fileUrl } = processData;
          
          const newMessage = await Message.create({
            senderId: senderId || 'user',
            receiverId: receiverId || 'admin',
            content,
            type: type || 'text',
            fileUrl,
            clientId: processData.clientId
          });

          // Update conversation
          const targetUserId = (senderId || 'user') === 'admin' ? receiverId : senderId;
          await Conversation.findOneAndUpdate(
            { userId: targetUserId },
            {
              $set: {
                userId: targetUserId,
                participants: [targetUserId, 'admin'],
                lastMessage: { 
                  content: (type || 'text') === 'text' ? content : 'Attachment', 
                  type: type || 'text', 
                  createdAt: new Date() 
                },
                updatedAt: new Date()
              },
              $inc: (senderId || 'user') === 'admin' ? {} : { unreadCount: 1 }
            },
            { upsert: true, new: true }
          );

          result = { 
            success: true, 
            message: 'Message processed and saved successfully',
            messageId: newMessage._id
          };
        } else {
          result = { 
            success: true, 
            message: 'Data processed successfully',
            processedData: processData
          };
        }
        break;

      default:
        return res.status(400).json({ 
          error: 'Invalid action', 
          supportedActions: ['encrypt', 'decrypt', 'process'] 
        });
    }

    // Optionally encrypt the response
    const { encryptResponse } = req.body;
    if (encryptResponse) {
      const encryptedResponse = encryptObject(result);
      return res.json({ encryptedResponse });
    }

    res.json(result);
  } catch (e) {
    console.error('Gateway error:', e);
    res.status(500).json({ error: 'Gateway processing error', details: e.message });
  }
});

// Gateway GET route for health check or info
app.get('/gateway', (req, res) => {
  res.json({
    status: 'active',
    endpoint: '/gateway',
    supportedActions: ['encrypt', 'decrypt', 'process'],
    description: 'Gateway endpoint with crypto encryption support',
    usage: {
      encrypt: {
        method: 'POST',
        body: { action: 'encrypt', data: { /* your data */ } }
      },
      decrypt: {
        method: 'POST',
        body: { action: 'decrypt', encryptedData: 'iv:tag:encrypted' }
      },
      process: {
        method: 'POST',
        body: { action: 'process', encryptedData: 'iv:tag:encrypted' }
      }
    }
  });
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
