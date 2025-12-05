const express = require('express');
const router = express.Router();
const SocketMapping = require('../models/SocketMapping');
const auth = require('../middleware/auth');

// Get mapping for a userId (admin or user can query their own id)
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const mapping = await SocketMapping.findOne({ userId }).lean();
    res.json(mapping || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
