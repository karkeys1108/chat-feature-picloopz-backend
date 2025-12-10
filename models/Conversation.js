const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  participants: [{ type: String }], // [userId, 'admin']
  userId: { type: String, required: true, unique: true }, // 1-to-1 with Admin
  roomId: { type: String, unique: true }, // Unique UUID for the room
  lastMessage: {
    content: String,
    type: { type: String, enum: ['text', 'image', 'file', 'audio', 'video'], default: 'text' },
    createdAt: Date
  },
  unreadCount: { type: Number, default: 0 }, // For Admin's view
}, { timestamps: true });

// Index for sorting admin list
ConversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
