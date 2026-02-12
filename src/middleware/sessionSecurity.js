// Session Security Middleware
// Device ID + User-Agent fingerprinting to prevent session hijacking
// (IP-based check removed to avoid VPN/mobile network logout issues)

/**
 * Saves device fingerprint into session during login/register.
 * deviceInfo comes from the client (localStorage UUID + basic fingerprint).
 */
function setSessionFingerprint(req, deviceInfo = {}) {
  const userAgent = req.headers['user-agent'] || 'unknown';

  req.session.fingerprint = {
    deviceId: deviceInfo.deviceId || 'unknown',
    userAgent,
    screenResolution: deviceInfo.deviceFingerprint?.screenResolution || 'unknown',
    timezone: deviceInfo.deviceFingerprint?.timezone || 'unknown'
  };
}

/**
 * Validates session fingerprint on each request.
 * Compares current User-Agent with the stored value.
 * Device ID is already bound to the session at login time,
 * so subsequent requests only need User-Agent consistency check.
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

  const currentUserAgent = req.headers['user-agent'] || 'unknown';
  const storedFingerprint = req.session.fingerprint;

  // Check if User-Agent changed (possible session theft)
  if (currentUserAgent !== storedFingerprint.userAgent) {
    console.warn('Session hijacking attempt detected:', {
      userId: req.session.userId,
      storedDeviceId: storedFingerprint.deviceId,
      storedUserAgent: storedFingerprint.userAgent.substring(0, 50),
      currentUserAgent: currentUserAgent.substring(0, 50)
    });

    // Destroy session immediately
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying hijacked session:', err);
      }
    });

    return res.status(401).json({
      success: false,
      message: 'Session security validation failed. Please login again.',
      code: 'SESSION_HIJACKING_DETECTED'
    });
  }

  // Fingerprint valid, allow request
  next();
}

module.exports = {
  validateSessionFingerprint,
  setSessionFingerprint
};
