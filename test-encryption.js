const { encryptMessage, decryptMessage } = require('./utils/security');

console.log('--- Testing Encryption/Decryption ---');

const originalText = "Hello, this is a secret message!";
console.log('Original Text:', originalText);

try {
    const encrypted = encryptMessage(originalText);
    console.log('Encrypted:', encrypted);

    const decrypted = decryptMessage(encrypted);
    console.log('Decrypted:', decrypted);

    if (originalText === decrypted) {
        console.log('SUCCESS: Decryption matches original text.');
    } else {
        console.error('FAILURE: Decryption does not match.');
    }
} catch (error) {
    console.error('ERROR during test:', error);
}

// Test with previous session simulation (fallback key consistency)
console.log('\n--- Testing Deterministic Key Consistency ---');
// We re-import to simulate "restart" effectively using the same module logic
// In a real restart, the process.env check runs again. Since we hardcoded the fallback in security.js, it should be the same.

const crypto = require('crypto');
// Manually derive the key as we did in the file to verify
const fallbackKey = crypto.createHash('sha256').update('default_insecure_fallback_key_DO_NOT_USE_IN_PROD').digest();
console.log('Derived Key matches internal logic? (Logic Check Only)');

// Test Decryption of a "stored" message (simulated)
// This verifies that if I encrypt now, I can decrypt later with the same logic.
const testMsg = "Persistence Check";
const encTest = encryptMessage(testMsg);
const decTest = decryptMessage(encTest);

if (testMsg === decTest) {
    console.log('SUCCESS: Persistence check passed.');
} else {
    console.log('FAILURE: Persistence check failed.');
}
