const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

async function createMessage({ conversationId, senderId, senderRole, content, type = 'text', media, clientId }) {
  const msg = await Message.create({ conversationId, senderId, senderRole, content, type, media, clientId });
  await Conversation.findByIdAndUpdate(conversationId, { $set: { updatedAt: new Date() } });
  return msg;
}

module.exports = { createMessage };
