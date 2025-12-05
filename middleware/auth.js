const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing authorization header' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    console.error('[Auth] token verify failed:', err && err.message ? err.message : err);
    return res.status(401).json({ error: 'Invalid token', details: err && err.message ? err.message : undefined });
  }
}

module.exports = authMiddleware;
