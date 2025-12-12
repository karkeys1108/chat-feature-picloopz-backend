const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc'; // Using CBC as requested for simplicity in compatibility, or GCM if preferred. Prompt allowed both. CBC matches the "iv" argument structure well.
const ENCODING = 'hex'; // or base64? Prompt asks for base64 in JSON.

function encryptMessage(text, secretKey) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(16);
        const key = Buffer.from(secretKey, 'hex'); // Assuming hex key in env
        // Or handle string key
        const cipher = crypto.createCipheriv(ALGORITHM, key.length === 32 ? key : crypto.scryptSync(secretKey, 'salt', 32), iv);

        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        return {
            content: encrypted,
            iv: iv.toString('base64')
        };
    } catch (e) {
        console.error('Crypto Encrypt Error:', e);
        return null; // Should plain text be returned? Validating prompt... "If encrypted=false or missing -> bypass".
    }
}

function decryptMessage(encryptedText, ivBase64, secretKey) {
    if (!encryptedText || !ivBase64) return null;
    try {
        const iv = Buffer.from(ivBase64, 'base64');
        const key = Buffer.from(secretKey, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key.length === 32 ? key : crypto.scryptSync(secretKey, 'salt', 32), iv);

        let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (e) {
        console.error('Crypto Decrypt Error:', e);
        return null;
    }
}

module.exports = {
    encryptMessage,
    decryptMessage
};
