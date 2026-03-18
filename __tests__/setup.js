// Load test environment variables BEFORE any module imports
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), override: true });
