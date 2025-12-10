const crypto = require('crypto');

// Get encryption key from environment or use a default (should be set in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For GCM, this is 12, but we'll use 16 for compatibility
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

/**
 * Encrypts data using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted data in format: iv:tag:encryptedData
 */
function encrypt(text) {
  try {
    // Ensure we have a 32-byte key
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(12); // GCM standard IV length is 12
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Return iv:tag:encryptedData
    return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypts data using AES-256-GCM
 * @param {string} encryptedData - Encrypted data in format: iv:tag:encryptedData
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedData) {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    // Ensure we have a 32-byte key
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Decryption failed');
  }
}

/**
 * Encrypts an object by converting it to JSON first
 * @param {object} data - Object to encrypt
 * @returns {string} - Encrypted data
 */
function encryptObject(data) {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypts data and parses it as JSON
 * @param {string} encryptedData - Encrypted data
 * @returns {object} - Decrypted object
 */
function decryptObject(encryptedData) {
  const decrypted = decrypt(encryptedData);
  return JSON.parse(decrypted);
}

module.exports = {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject
};

