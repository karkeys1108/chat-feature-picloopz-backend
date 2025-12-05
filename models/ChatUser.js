const mongoose = require('mongoose');

const ChatUserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true }, // From main server
    name: { type: String, required: true },
    email: { type: String, required: true },
    avatar: { type: String },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ChatUser', ChatUserSchema);
