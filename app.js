// Load environment variables
require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
var pgSession = require('connect-pg-simple')(session);
var helmet = require('helmet');
var rateLimit = require('express-rate-limit');
var { validateSessionFingerprint } = require('./src/middleware/sessionSecurity');

// Database
var { pool, initDatabase } = require('./src/models/database');

var authRouter = require('./src/routes/authRoutes');
var projectRouter = require('./src/routes/projectRoutes');
var githubRouter = require('./src/routes/githubRoutes');
var notificationRouter = require('./src/routes/notificationRoutes');

var app = express();

// Trust proxy to get real IP when behind reverse proxy (nginx, cloudflare, etc.)
// Should be true in production, false in development
app.set('trust proxy', process.env.NODE_ENV === 'production');

// Initialize database (async - tables are created before server starts)
// In test environment, tests handle initialization themselves
if (process.env.NODE_ENV !== 'test') {
  initDatabase().catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// Disable morgan logging in test environment
if (process.env.NODE_ENV !== 'test') {
  app.use(logger('dev'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use(helmet());

// Session configuration
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true
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
    sameSite: 'lax' // lax needed for OAuth redirect (callback is cross-site GET)
  }
}));

// Session security - validate fingerprint on every request
app.use(validateSessionFingerprint);

// Rate limiting - Different limits for different endpoints
const isTest = process.env.NODE_ENV === 'test';

// Auth endpoints: Stricter (prevent brute force, registration spam)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 300,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/me'
});

// General API endpoints: More lenient (normal app usage)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 1000,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiters
app.use('/api/auth', authLimiter);
app.use('/api/projects', apiLimiter);
app.use('/api/github', apiLimiter);

// Auth routes
app.use('/api/auth', authRouter);

// Project routes
app.use('/api/projects', projectRouter);

// GitHub OAuth routes
app.use('/api/github', githubRouter);

// Notification routes
app.use('/api/notifications', apiLimiter);
app.use('/api/notifications', notificationRouter);

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
