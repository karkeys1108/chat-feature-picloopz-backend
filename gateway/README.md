# Admin Chat Gateway Encryption

The chat system now uses a dedicated Gateway Layer (`/gateway/chatGateway.js`) to enforce AES-256-CBC encryption on all WebSocket events.

## Configuration

To enable or disable encryption, set the environment variables in your `.env` file (or deployment config):

```env
ENABLE_GATEWAY_ENCRYPTION=true
SECRET_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff # Must be 32 bytes hex
```

- **Enable:** Set `ENABLE_GATEWAY_ENCRYPTION=true`.
- **Disable:** Set to `false` for debugging or plain-text mode.
- **Key Rotation:** Change `SECRET_KEY` and restart the server. Note that this affects *transit* encryption. Database encryption keys (in `utils/security.js`) are separate.

## Architecture

1.  **Gateway:** `gateway/chatGateway.js` wraps the socket.
2.  **Intercepts:** `send_message` (Inbound) and `receive_message` (Outbound).
3.  **Crypto:** `utils/crypto.js` handles the AES logic.

## Client Integration

Clients must decrypt inbound messages ({ encrypted: true, content, iv }) and encrypt outbound messages before emitting.
