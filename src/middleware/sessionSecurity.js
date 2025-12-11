// Session Security Middleware
// IP + User-Agent fingerprinting to prevent session hijacking

/**
 * Creates a session fingerprint from request data
 * Fingerprint includes IP address and User-Agent
 * Used to detect session hijacking attempts
 */
function createFingerprint(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';

  return {
    ip,
    userAgent
  };
}

/**
 * Validates session fingerprint on each request
 * Compares current IP and User-Agent with stored values
 * If mismatch detected, destroys session (possible hijacking)
 */
function validateSessionFingerprint(req, res, next) {
  // Skip validation for non-authenticated users
  if (!req.session || !req.session.userId) {
    return next();
  }

  // Reject sessions without fingerprint (security requirement)
  if (!req.session.fingerprint) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying invalid session:', err);
      }
    });

    return res.status(401).json({
      success: false,
      message: 'Invalid session. Please login again.',
      code: 'INVALID_SESSION'
    });
  }

  const currentFingerprint = createFingerprint(req);
  const storedFingerprint = req.session.fingerprint;

  // Detect fingerprint mismatch
  const ipChanged = currentFingerprint.ip !== storedFingerprint.ip;
  const userAgentChanged = currentFingerprint.userAgent !== storedFingerprint.userAgent;

  if (ipChanged || userAgentChanged) {
    console.warn('Session hijacking attempt detected:', {
      userId: req.session.userId,
      storedIp: storedFingerprint.ip,
      currentIp: currentFingerprint.ip,
      storedUserAgent: storedFingerprint.userAgent.substring(0, 50),
      currentUserAgent: currentFingerprint.userAgent.substring(0, 50),
      ipChanged,
      userAgentChanged
    });

    // Destroy session immediately for security
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying hijacked session:', err);
      }
    });

    // Reject request with 401 Unauthorized
    return res.status(401).json({
      success: false,
      message: 'Session security validation failed. Please login again.',
      code: 'SESSION_HIJACKING_DETECTED'
    });
  }

  // Fingerprint valid, allow request
  next();
}

/**
 * Helper to set session fingerprint during login/register
 */
function setSessionFingerprint(req) {
  req.session.fingerprint = createFingerprint(req);
}

module.exports = {
  validateSessionFingerprint,
  setSessionFingerprint,
  createFingerprint
};
