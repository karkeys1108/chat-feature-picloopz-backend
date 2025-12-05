Chat Feature Backend for Picloopz
================================

This service provides a Socket.IO + Express backend to support realtime chat between users and admins. It persists conversations and messages in MongoDB and supports media uploads (via multer + Cloudinary optional).

Quick start
-----------

1. Copy example env: `cp .env.example .env` and fill values (on Windows use copy).
2. Install dependencies: `npm install` in `chat-feature-backend`.
3. Run in dev: `npm run dev` or `npm start`.

Environment variables
---------------------
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - JWT secret used to authenticate REST & socket connections
- `PORT` - server port (default 4000)
- `CLOUDINARY_*` - optional credentials to enable Cloudinary uploads

API overview
------------
- `GET /api/conversations` - list conversations (admin requires admin JWT)
- `GET /api/conversations/:id/messages` - list messages for conversation
- `POST /api/messages` - send a message (fallback non-socket)
- `POST /api/upload` - upload media (multipart/form-data) - optional cloudinary

Socket events
-------------
- Client emits `join` with `{ token }` to authenticate and will join a personal room `user:{userId}`.
- Client emits `joinConversation` with `{ conversationId }` to join conversation room.
- Client emits `message` with `{ conversationId, content, type, mediaUrl }` to send message.
- Server emits `message` to relevant rooms when a message is persisted.

Notes
-----
- This repo is a minimal starting point. You will need to wire authentication from your main app (issue JWTs for users/admins) and adapt the models to match your existing User model if you want to reference `User` documents.
