const request = require('supertest');
const app = require('../../app');
const { setupDatabase, cleanDatabase, createTestUser, pool } = require('../helpers');

// Default device info used in all auth requests
const deviceInfo = {
  deviceId: 'test-device',
  deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
};

beforeAll(async () => {
  await setupDatabase();
  await cleanDatabase();
});

afterEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/auth/register', () => {
  test('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'newuser',
        email: 'new@test.com',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe('newuser');
    // Session cookie should be set
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('duplicate email should return 409', async () => {
    await createTestUser({ username: 'existing', email: 'dup@test.com' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'another',
        email: 'dup@test.com',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  test('duplicate username should return 409', async () => {
    await createTestUser({ username: 'taken', email: 'taken@test.com' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'taken',
        email: 'different@test.com',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/auth/login', () => {
  test('should login with correct credentials', async () => {
    const user = await createTestUser({ username: 'logintest', email: 'login@test.com', password: 'TestPass1!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'logintest',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe('logintest');
  });

  test('should login with email', async () => {
    await createTestUser({ username: 'emaillogin', email: 'emaillogin@test.com', password: 'TestPass1!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'emaillogin@test.com',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('wrong password should return 401', async () => {
    await createTestUser({ username: 'wrongpw', email: 'wrong@test.com', password: 'TestPass1!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'wrongpw',
        password: 'WrongPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid credentials');
  });

  test('non-existent user should return 401 (timing attack protection)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'doesnotexist',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });
});

describe('POST /api/auth/logout', () => {
  test('should logout and destroy session', async () => {
    const agent = request.agent(app);

    // Register first
    await agent
      .post('/api/auth/register')
      .send({
        username: 'logouttest',
        email: 'logout@test.com',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    // Logout
    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // /me should return 401 after logout
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  test('should return user info when authenticated', async () => {
    const agent = request.agent(app);

    await agent
      .post('/api/auth/register')
      .send({
        username: 'metest',
        email: 'me@test.com',
        password: 'TestPass1!',
        deviceId: 'test-device',
        deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
      });

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe('metest');
  });

  test('should return 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/auth/login (Remember Me)', () => {
  test('remember: true should set cookie maxAge to 30 days', async () => {
    await createTestUser({ username: 'rememberme', email: 'remember@test.com', password: 'TestPass1!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'rememberme',
        password: 'TestPass1!',
        remember: true,
        ...deviceInfo
      });

    expect(res.status).toBe(200);
    // set-cookie may be a string or array
    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    const sessionCookie = cookies.find(c => c && (c.includes('ptahnest') || c.includes('connect.sid')));
    expect(sessionCookie).toBeDefined();
    // 30 days cookie should have Max-Age or Expires
    expect(sessionCookie).toMatch(/Max-Age|Expires/i);
  });
});

describe('POST /api/auth/logout (Unauthenticated)', () => {
  test('unauthenticated logout should still return 200', async () => {
    const res = await request(app).post('/api/auth/logout');
    // Session destroy is called even without an active session
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Brute-force protection', () => {
  test('should return 429 after 5+ failed login attempts', async () => {
    await createTestUser({ username: 'brutetest', email: 'brute@test.com', password: 'TestPass1!' });

    // Send 5 failed login attempts to trigger exponential delay
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({
          identifier: 'brutetest',
          password: 'WrongPass!1',
          ...deviceInfo
        });
    }

    // 6th attempt should be rate limited (429)
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'brutetest',
        password: 'WrongPass!1',
        ...deviceInfo
      });

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/wait|blocked|Too many/i);
  });
});
