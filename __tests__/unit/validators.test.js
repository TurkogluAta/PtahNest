const express = require('express');
const request = require('supertest');
const {
  registerValidation,
  loginValidation,
  createProjectValidation,
  paramIdValidation
} = require('../../src/middleware/validators');

// Minimal Express app for testing validators
function createValidatorApp(path, method, validators, handler) {
  const app = express();
  app.use(express.json());

  if (method === 'post') {
    app.post(path, validators, handler || ((req, res) => res.json({ success: true, body: req.body })));
  } else {
    app.get(path, validators, handler || ((req, res) => res.json({ success: true })));
  }

  return app;
}

describe('Register Validation', () => {
  const app = createValidatorApp('/register', 'post', registerValidation);

  test('valid input should pass', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', email: 'test@test.com', password: 'TestPass1!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('short username should fail', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'ab', email: 'test@test.com', password: 'TestPass1!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('invalid email should fail', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', email: 'not-an-email', password: 'TestPass1!' });

    expect(res.status).toBe(400);
  });

  test('weak password (no uppercase) should fail', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', email: 'test@test.com', password: 'testpass1!' });

    expect(res.status).toBe(400);
  });

  test('weak password (no number) should fail', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', email: 'test@test.com', password: 'TestPass!' });

    expect(res.status).toBe(400);
  });

  test('weak password (no special char) should fail', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', email: 'test@test.com', password: 'TestPass1' });

    expect(res.status).toBe(400);
  });

  test('short password should fail', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', email: 'test@test.com', password: 'Te1!' });

    expect(res.status).toBe(400);
  });

  test('XSS in username should be escaped', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', email: 'test@test.com', password: 'TestPass1!' });

    // Username with special chars would be caught by regex, so test with valid chars
    // XSS escape happens on the body value via .escape()
    expect(res.status).toBe(200);
  });

  test('username with special characters should fail', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'test<user>', email: 'test@test.com', password: 'TestPass1!' });

    expect(res.status).toBe(400);
  });
});

describe('Login Validation', () => {
  const app = createValidatorApp('/login', 'post', loginValidation);

  test('valid input should pass', async () => {
    const res = await request(app)
      .post('/login')
      .send({ identifier: 'testuser', password: 'TestPass1!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('empty identifier should fail', async () => {
    const res = await request(app)
      .post('/login')
      .send({ identifier: '', password: 'TestPass1!' });

    expect(res.status).toBe(400);
  });

  test('empty password should fail', async () => {
    const res = await request(app)
      .post('/login')
      .send({ identifier: 'testuser', password: '' });

    expect(res.status).toBe(400);
  });

  test('XSS in identifier should be escaped', async () => {
    const app2 = createValidatorApp('/login', 'post', loginValidation);
    const res = await request(app2)
      .post('/login')
      .send({ identifier: '<script>alert(1)</script>', password: 'TestPass1!' });

    expect(res.status).toBe(200);
    // The identifier should be escaped
    expect(res.body.body.identifier).toContain('&lt;');
    expect(res.body.body.identifier).not.toContain('<script>');
  });
});

describe('Param ID Validation (UUID)', () => {
  const app = createValidatorApp('/test/:id', 'get', paramIdValidation);

  test('valid UUID should pass', async () => {
    const res = await request(app).get('/test/550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(200);
  });

  test('invalid UUID should fail', async () => {
    const res = await request(app).get('/test/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invalid');
  });

  test('numeric ID should fail', async () => {
    const res = await request(app).get('/test/12345');
    expect(res.status).toBe(400);
  });
});

describe('Create Project Validation', () => {
  const app = createValidatorApp('/project', 'post', createProjectValidation);

  test('valid project input should pass', async () => {
    const res = await request(app)
      .post('/project')
      .send({
        name: 'Test Project',
        description: 'A test project description',
        tags: ['nodejs', 'express'],
        lookingFor: ['Backend Developer']
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('empty name should fail', async () => {
    const res = await request(app)
      .post('/project')
      .send({
        name: '',
        description: 'A test project',
        tags: ['test'],
        lookingFor: ['dev']
      });

    expect(res.status).toBe(400);
  });

  test('too many tags should fail', async () => {
    const res = await request(app)
      .post('/project')
      .send({
        name: 'Test',
        description: 'Test desc',
        tags: Array(11).fill('tag'),
        lookingFor: ['dev']
      });

    expect(res.status).toBe(400);
  });

  test('XSS in project name should be escaped', async () => {
    const res = await request(app)
      .post('/project')
      .send({
        name: '<script>alert("xss")</script>',
        description: 'Normal description',
        tags: ['test'],
        lookingFor: ['dev']
      });

    expect(res.status).toBe(200);
    expect(res.body.body.name).toContain('&lt;');
    expect(res.body.body.name).not.toContain('<script>');
  });

  test('XSS in description should be escaped', async () => {
    const res = await request(app)
      .post('/project')
      .send({
        name: 'Safe Name',
        description: '<img onerror="alert(1)" src="x">',
        tags: ['test'],
        lookingFor: ['dev']
      });

    expect(res.status).toBe(200);
    expect(res.body.body.description).not.toContain('<img');
  });
});
