const crypto = require('crypto');

// --- Configuration --- //
const ALGORITHM = 'aes-256-gcm';
// Keys should be in .env. 
// We use a deterministic fallback so restarts don't lose access to data if env is missing.
const ENCRYPTION_KEY = process.env.CHAT_ENCRYPTION_KEY
    ? Buffer.from(process.env.CHAT_ENCRYPTION_KEY, 'hex')
    : crypto.createHash('sha256').update('default_insecure_fallback_key_DO_NOT_USE_IN_PROD').digest();

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
/**
 * Decrypts text using AES-256-GCM
 * Expects format: iv:authTag:encryptedContent
 */
function decryptMessage(text) {
    if (!text || typeof text !== 'string' || !text.includes(':')) return text;

    // Strict Validation to avoid treating "Time: 12:00" as encrypted
    const parts = text.split(':');
    if (parts.length !== 3) return text;

    // IV (12 bytes) = 24 hex chars
    // AuthTag (16 bytes) = 32 hex chars
    if (parts[0].length !== 24 || parts[1].length !== 32) {
        // Not a valid encrypted string format, assume plain text
        return text;
    }

    // Helper to attempt decryption with a specific key
    const tryDecrypt = (key, keyName) => {
        try {
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encryptedText = parts[2];

            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (err) {
            // console.debug(`[Security] Decryption failed with ${keyName}: ${err.message}`);
            return null;
        }
    };

    // 1. Try Primary Key
    let result = tryDecrypt(ENCRYPTION_KEY, 'Primary');
    if (result !== null) return result;

    // 2. Try Fallback Key (handling legacy data during dev/migration)
    const fallbackKey = crypto.createHash('sha256').update('default_insecure_fallback_key_DO_NOT_USE_IN_PROD').digest();
    if (!ENCRYPTION_KEY.equals(fallbackKey)) {
        result = tryDecrypt(fallbackKey, 'Fallback');
        if (result !== null) return result;
    }

    // If both failed, it's likely a true decryption failure (wrong key or corrupted)
    console.error(`[Security] Decryption failed for message: ${text.substring(0, 20)}...`);
    return '[Decryption Failed]';
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

        // Check expiry (e.g. 24 hours for dev stability)
        const expiryDuration = 24 * 60 * 60 * 1000;
        if (Date.now() - data.ts > expiryDuration) {
            console.log('[Token Expired] Token timestamp:', new Date(data.ts).toISOString(), 'Now:', new Date().toISOString());
            return null;
        }

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
