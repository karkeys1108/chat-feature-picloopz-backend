const mongoose = require('mongoose');

const SocketMappingSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    socketId: { type: String, required: true },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SocketMapping', SocketMappingSchema);
