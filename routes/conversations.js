const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const auth = require('../middleware/auth');

// List conversations for the current user (or all for admin)
router.get('/', auth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    let filter = {};
    if (role !== 'admin') {
      filter = { 'participants.userId': userId };
    }
    const convos = await Conversation.find(filter).sort({ updatedAt: -1 }).lean();
    res.json(convos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create or get a conversation between a user and admin (idempotent)
// This route accepts authenticated requests or a body with `userId` for unauthenticated clients.
router.post('/with-admin', async (req, res) => {
  try {
    // prefer authenticated userId, fallback to provided userId or generate guest
    const userId = req.user?.userId || req.body?.userId || `guest_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    let convo = await Conversation.findOne({ 'participants.userId': userId }).lean();
    if (!convo) {
      convo = await Conversation.create({ participants: [{ userId, role: 'user' }, { userId: 'admin', role: 'admin' }] });
    }
    res.json(convo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Merge a guest conversation into an authenticated user account
// Expects auth middleware (JWT) to identify the target user
router.post('/merge', async (req, res) => {
  try {
    // require auth
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization' });
    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { guestId } = req.body;
    if (!guestId) return res.status(400).json({ error: 'guestId required' });

    // Find conversation with guestId participant
    const guestConvo = await Conversation.findOne({ 'participants.userId': guestId });
    if (!guestConvo) return res.json({ merged: false, message: 'No guest conversation found' });

    const userId = payload.userId;

    // If the user already has a conversation, merge messages
    let userConvo = await Conversation.findOne({ 'participants.userId': userId });
    if (!userConvo) {
      // rename guest participant to userId
      await Conversation.updateOne(
        { _id: guestConvo._id, 'participants.userId': guestId },
        { $set: { 'participants.$.userId': userId } }
      );
      userConvo = await Conversation.findById(guestConvo._id).lean();
      return res.json({ merged: true, conversation: userConvo });
    }

    // Both exist: move messages from guestConvo to userConvo and delete guestConvo
    const Message = require('../models/Message');
    await Message.updateMany({ conversationId: guestConvo._id }, { $set: { conversationId: userConvo._id } });
    await Conversation.deleteOne({ _id: guestConvo._id });

    const merged = await Conversation.findById(userConvo._id).lean();
    return res.json({ merged: true, conversation: merged });
  } catch (err) {
    console.error('merge error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get messages for conversation
router.get('/:id/messages', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await Message.find({ conversationId: id }).sort({ createdAt: 1 }).lean();
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
