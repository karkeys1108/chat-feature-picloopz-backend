const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  senderId: { type: String, required: true }, // userId or 'admin'
  receiverId: { type: String, required: true },
  content: { type: String },
  type: { type: String, enum: ['text', 'image', 'file', 'audio', 'video', 'system'], default: 'text' },
  fileUrl: { type: String }, // Cloudinary URL
  isRead: { type: Boolean, default: false },
  clientId: { type: String }, // For deduplication
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema);
