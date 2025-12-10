Chat Feature Backend for Picloopz
================================

This service provides a Socket.IO + Express backend to support realtime chat between users and admins. It persists conversations and messages in MongoDB and supports media uploads (via multer + Cloudinary optional). Includes a secure gateway route with crypto encryption for sensitive data.

Quick start
-----------

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```
   (On Windows: `copy .env.example .env`)

2. **Edit `.env` file** and fill in your values:
   - `MONGO_URI` - Your MongoDB connection string
   - `JWT_SECRET` - A secure random string for JWT authentication
   - `ENCRYPTION_KEY` - Generate a secure key:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - `PORT` - Server port (default: 4000)
   - `CLOUDINARY_*` - Optional Cloudinary credentials for media uploads

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Run the server:**
   ```bash
   # Development mode (with auto-reload)
   npm run dev
   
   # Production mode
   npm start
   ```

5. **Test the API:**
   - See `curl.txt` for example API calls
   - Server will run on `http://localhost:4000` (or your configured PORT)

Environment variables
---------------------
- `MONGO_URI` - MongoDB connection string (required)
- `JWT_SECRET` - JWT secret used to authenticate REST & socket connections (required)
- `ENCRYPTION_KEY` - Encryption key for gateway route (32+ characters, required)
- `PORT` - Server port (default: 4000)
- `CLOUDINARY_CLOUD_NAME` - Optional Cloudinary cloud name
- `CLOUDINARY_API_KEY` - Optional Cloudinary API key
- `CLOUDINARY_API_SECRET` - Optional Cloudinary API secret

API overview
------------

### Gateway Route (Crypto Encryption)
- `GET /gateway` - Get gateway endpoint information
- `POST /gateway` - Encrypt, decrypt, or process encrypted data
  - Actions: `encrypt`, `decrypt`, `process`
  - See `curl.txt` for detailed examples

### Chat API Endpoints
- `POST /api/chat/upload` - Upload media file (multipart/form-data)
- `GET /api/chat/conversations` - List all conversations (admin sidebar)
- `GET /api/chat/history/:userId` - Get chat history for a user
- `POST /api/chat/read/:userId` - Mark messages as read

### Gateway Usage Examples

**Encrypt data:**
```bash
curl -X POST http://localhost:4000/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "action": "encrypt",
    "data": {
      "message": "Secret message",
      "userId": "user123"
    }
  }'
```

**Decrypt data:**
```bash
curl -X POST http://localhost:4000/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "action": "decrypt",
    "encryptedData": "iv:tag:encrypted"
  }'
```

**Process encrypted message (saves to database):**
```bash
curl -X POST http://localhost:4000/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "action": "process",
    "encryptedData": "iv:tag:encrypted"
  }'
```

For more examples, see `curl.txt` file.

Socket events
-------------
- Client emits `identify_user` with `{ userId, name, email, avatar }` to identify as a user
- Client emits `identify_admin` to identify as an admin
- Client emits `send_message` with `{ senderId, receiverId, content, type, fileUrl }` to send message
- Server emits `receive_message` to relevant rooms when a message is persisted
- Server emits `user_status` to admin room when user online status changes
- Server emits `chat_list_update` to admin room when conversation list updates

Security
--------
- Gateway route uses AES-256-GCM encryption for secure data transmission
- Encryption key should be kept secret and never committed to version control
- Use HTTPS in production for additional security
- JWT tokens should be validated for protected routes

Testing
-------
Use the provided `curl.txt` file for testing all endpoints. The file contains ready-to-use curl commands for:
- Gateway encryption/decryption
- Chat API endpoints
- Complete workflow examples

Notes
-----
- This repo is a minimal starting point. You will need to wire authentication from your main app (issue JWTs for users/admins) and adapt the models to match your existing User model if you want to reference `User` documents.
- The gateway route provides end-to-end encryption for sensitive data before it reaches the database.
- Make sure to set a strong `ENCRYPTION_KEY` in production (minimum 32 characters).
