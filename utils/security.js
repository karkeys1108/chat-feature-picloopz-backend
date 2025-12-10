const crypto = require('crypto');

// --- Configuration --- //
const ALGORITHM = 'aes-256-gcm';
// Keys should be in .env. 
// For demo purposes, we fallback to random if not present, BUT this will break persistence across restarts if not fixed.
const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY
    ? Buffer.from(process.env.CHAT_ENCRYPTION_KEY, 'hex')
    : crypto.randomBytes(32);

const HMAC_SECRET = process.env.CHAT_HMAC_SECRET || 'your_fallback_hmac_secret_change_me';
const IV_LENGTH = 16; // For AES, usually 12 for GCM but can use 16. GCM standard is often 12. Let's use 12 for GCM.
const GCM_IV_LENGTH = 12;

/**
 * Encrypts text using AES-256-GCM
 * Returns user-friendly format: iv:authTag:encryptedContent (hex encoded)
 */
function encryptMessage(text) {
    if (!text) return text;

    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    // Format: IV:AuthTag:EncryptedData
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts text using AES-256-GCM
 * Expects format: iv:authTag:encryptedContent
 */
function decryptMessage(text) {
    if (!text || !text.includes(':')) return text; // Return as is if not encrypted format

    try {
        const parts = text.split(':');
        if (parts.length !== 3) return text; // Malformed

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (err) {
        console.error('Decryption failed:', err.message);
        return '[Decryption Failed]';
    }
}

/**
 * Generates a signed HMAC token for a room Join
 * Payload includes userId and timestamp.
 * Token expires in 5 minutes (user must connect socket within that time).
 */
function generateRoomToken(userId, role = 'user') {
    const payload = JSON.stringify({
        uid: userId,
        role: role,
        ts: Date.now()
    });

    const signature = crypto.createHmac('sha256', HMAC_SECRET)
        .update(payload)
        .digest('hex');

    // Return base64 version of payload + signature
    return Buffer.from(`${payload}.${signature}`).toString('base64');
}

/**
 * Verifies the token. Returns decoded payload if valid, null otherwise.
 */
function verifyRoomToken(token) {
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [payloadStr, signature] = decoded.split('.');

        if (!payloadStr || !signature) return null;

        // Verify Signature
        const expectedSignature = crypto.createHmac('sha256', HMAC_SECRET)
            .update(payloadStr)
            .digest('hex');

        if (signature !== expectedSignature) return null;

        const data = JSON.parse(payloadStr);

        // Check expiry (e.g. 5 minutes)
        const fiveMinutes = 5 * 60 * 1000;
        if (Date.now() - data.ts > fiveMinutes) return null; // Expired

        return data;
    } catch (e) {
        return null;
    }
}

module.exports = {
    encryptMessage,
    decryptMessage,
    generateRoomToken,
    verifyRoomToken
};
