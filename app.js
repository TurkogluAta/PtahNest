// Load environment variables
require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
var SQLiteStore = require('better-sqlite3-session-store')(session);
var helmet = require('helmet');
var rateLimit = require('express-rate-limit');
var { validateSessionFingerprint } = require('./src/middleware/sessionSecurity');

// Database
var { db, initDatabase } = require('./src/models/database');

var authRouter = require('./src/routes/authRoutes');
var projectRouter = require('./src/routes/projectRoutes');

var app = express();

// Trust proxy to get real IP when behind reverse proxy (nginx, cloudflare, etc.)
// Should be true in production, false in development
app.set('trust proxy', process.env.NODE_ENV === 'production');

// Initialize database
initDatabase();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use(helmet());

// Session configuration
app.use(session({
  store: new SQLiteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 900000 // Clean expired sessions every 15 minutes
    }
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Refresh session expiry time on each request
  name: process.env.SESSION_NAME || 'ptahnest_session',
  cookie: {
    // No maxAge = Session cookie (deleted when browser closes)
    // If "remember me" is active, maxAge is set in authRoutes.js
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
}));

// Session security - validate fingerprint on every request
app.use(validateSessionFingerprint);

// Rate limiting - Different limits for different endpoints
// Auth endpoints: Stricter (prevent brute force, registration spam)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 100 requests per 15 min (allows page refreshes + auth checks)
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for /me endpoint (auth checks)
  skip: (req) => req.path === '/me'
});

// General API endpoints: More lenient (normal app usage)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 min (~66 req/min, allows page refreshes & development)
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiters
app.use('/api/auth', authLimiter);
app.use('/api/projects', apiLimiter);

// Auth routes
app.use('/api/auth', authRouter);

// Project routes
app.use('/api/projects', projectRouter);

// Redirect root to appropriate page based on auth status
app.get('/', (req, res) => {
  // If user is logged in, redirect to dashboard
  if (req.session && req.session.userId) {
    res.redirect('/pages/index.html');
  } else {
    // Not logged in, redirect to auth page
    res.redirect('/pages/auth.html');
  }
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// Error handler
app.use(function(err, req, res, next) {
  // Return JSON error for API routes
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal server error',
      ...(req.app.get('env') === 'development' && { error: err.stack })
    });
  }

  // Return simple error page for HTML routes
  res.status(err.status || 500);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Error</title></head>
    <body>
      <h1>${err.status || 500} Error</h1>
      <p>${err.message || 'Internal Server Error'}</p>
      ${req.app.get('env') === 'development' ? `<pre>${err.stack}</pre>` : ''}
    </body>
    </html>
  `);
});

module.exports = app;
