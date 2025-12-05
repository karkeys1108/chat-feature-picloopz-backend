const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const auth = require('../middleware/auth');

// Post a message (fallback, non-socket way)
router.post('/', auth, async (req, res) => {
  try {
    const { conversationId, content, type, media, clientId } = req.body;
    const { userId, role } = req.user;
    const msg = await Message.create({ conversationId, senderId: userId, senderRole: role, content, type: type || 'text', media, clientId });
    await Conversation.findByIdAndUpdate(conversationId, { $set: { updatedAt: new Date() } });
    res.json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
