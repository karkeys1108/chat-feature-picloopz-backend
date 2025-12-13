const { encryptMessage, decryptMessage } = require('../utils/crypto');

const ENABLE_GATEWAY_ENCRYPTION = process.env.ENABLE_GATEWAY_ENCRYPTION === 'true' || true;
console.log(`[Gateway] Loaded. Encryption Enabled: ${ENABLE_GATEWAY_ENCRYPTION}`);
// Default key for demo if missing (32 bytes hex)
const SECRET_KEY = process.env.SECRET_KEY || '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const OUTBOUND_EVENTS = ['receive_message', 'chat_list_update', 'message_history'];
const INBOUND_EVENTS = ['send_message', 'typing', 'read_message', 'room_join', 'identify_user'];

/**
 * Encrypts outbound data object
 */
function encryptOutbound(data) {
    if (!ENABLE_GATEWAY_ENCRYPTION) {
        // console.log('[Gateway] Encryption Disabled (Passthrough at encryptOutbound)');
        return data;
    }

    // Debug
    // console.log('[Gateway] Encrypting Outbound Data...');
    // We only encrypt the 'content' field if it exists? 
    // OR wrap the entire payload? Prompt says: "Outbound encrypted messages must contain: { encrypted: true, iv, content, ...metadata }"
    // This implies payload transformation.

    // However, events like 'chat_list_update' have complex objects.
    // 'receive_message' has { content, senderId, ... }.

    // Strategy: JSON stringify the whole data, encrypt it, send wrapper.
    // OR: Only encrypt specific fields. The prompt example: content: "<encrypted-base64>". 
    // This suggests specific field encryption OR payload wrapping.
    // "content" usually refers to the message body.
    // BUT prompt says: "Gateway must wrap outgoing events... Outbound encrypted messages must contain: { encrypted: true, content: <encrypted payload?> }"

    // Interpretation: The ENTIRE data object is serialized and encrypted into 'content'.
    const jsonStr = JSON.stringify(data);
    const result = encryptMessage(jsonStr, SECRET_KEY);

    if (!result) return data; // Fallback

    return {
        encrypted: true,
        iv: result.iv,
        content: result.content
        // Metadata for routing? Usually socket events handle routing. 
        // We just replace the argument passed to emit.
    };
}

/**
 * Decrypts inbound data object
 */
function decryptInbound(data) {
    if (!ENABLE_GATEWAY_ENCRYPTION) return data;
    if (!data || !data.encrypted) return data; // Passthrough

    const jsonStr = decryptMessage(data.content, data.iv, SECRET_KEY);
    if (!jsonStr) return data; // Failed to decrypt

    try {
        const payload = JSON.parse(jsonStr);
        // Merge senderId if client sent it outside (though client usually sends inside)
        // Prompt says: Inbound: { encrypted: true, ..., senderId: "..." }
        // We restore original payload.
        return payload;
    } catch (e) {
        return data;
    }
}

/**
 * Intercepts socket events
 */
function attachGateway(socket) {
    if (!ENABLE_GATEWAY_ENCRYPTION) return;

    // 1. Intercept Outgoing (socket.emit)
    const originalEmit = socket.emit;
    socket.emit = function (event, ...args) {
        if (OUTBOUND_EVENTS.includes(event)) {
            // args[0] is usually the data payload
            const data = args[0];
            if (data) {
                const encryptedData = encryptOutbound(data);
                // Call original with encrypted data
                return originalEmit.apply(this, [event, encryptedData]);
            }
        }
        return originalEmit.apply(this, arguments);
    };

    // 2. Intercept Incoming (socket.on)
    // We wrap the listener provided by the application
    const originalOn = socket.on;
    socket.on = function (event, listener) {
        if (INBOUND_EVENTS.includes(event)) {
            const wrappedListener = (data, ...rest) => {
                const decryptedData = decryptInbound(data);
                return listener.call(this, decryptedData, ...rest);
            };
            return originalOn.call(this, event, wrappedListener);
        }
        return originalOn.call(this, event, listener);
    };

    console.log(`[Gateway] Attached encryption to socket ${socket.id}`);
}

/**
 * Intercepts Server Broadcasts (io.to().emit, io.emit)
 */
function attachServerGateway(io) {
    if (!ENABLE_GATEWAY_ENCRYPTION) return;

    // Patch io.emit (Broadcast to all)
    const originalIoEmit = io.emit;
    io.emit = function (event, ...args) {
        if (OUTBOUND_EVENTS.includes(event)) {
            const data = args[0];
            if (data) {
                const encryptedData = encryptOutbound(data);
                return originalIoEmit.apply(this, [event, encryptedData]);
            }
        }
        return originalIoEmit.apply(this, arguments);
    };

    // Patch io.to(...) (Multicast/Room)
    // io.to returns a BroadcastOperator
    const originalTo = io.to;
    io.to = function (...args) {
        const broadcaster = originalTo.apply(this, args);

        // Patch the broadcaster's emit
        const originalBroadcasterEmit = broadcaster.emit;
        broadcaster.emit = function (event, ...emitArgs) {
            if (OUTBOUND_EVENTS.includes(event)) {
                const data = emitArgs[0];
                if (data) {
                    const encryptedData = encryptOutbound(data);
                    return originalBroadcasterEmit.call(this, event, encryptedData);
                }
            }
            return originalBroadcasterEmit.apply(this, arguments);
        };

        return broadcaster;
    };

    // Also patch io.in alias
    io.in = io.to;

    console.log('[Gateway] Attached encryption to Server IO (Broadcasts/Rooms)');
    io.use((socket, next) => {
        // Optional: Wrap socket.emit here too if attachGateway(socket) isn't enough?
        // attachGateway is called in 'connection'. That's fine.
        next();
    });
}

/**
 * Express Middleware for HTTP Routes
 */
function expressMiddleware(req, res, next) {
    if (!ENABLE_GATEWAY_ENCRYPTION) return next();

    // 1. Decrypt Request Body
    if (req.body && req.body.encrypted && req.body.content) {
        const decrypted = decryptInbound(req.body);
        if (decrypted) {
            req.body = decrypted;
        }
    }

    // 2. Encrypt Response JSON
    const originalJson = res.json;
    res.json = function (data) {
        // Encrypt data before sending
        const encrypted = encryptOutbound(data);
        return originalJson.call(this, encrypted);
    };

    next();
}

module.exports = {
    attachGateway,
    attachServerGateway,
    encryptOutbound,
    decryptInbound,
    expressMiddleware
};
