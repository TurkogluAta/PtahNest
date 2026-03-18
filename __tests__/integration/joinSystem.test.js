const request = require('supertest');
const app = require('../../app');
const { setupDatabase, cleanDatabase, registerAndLogin, pool } = require('../helpers');

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

// Helper to create a research project
async function createProject(agent, name = 'Test Project') {
  const res = await agent
    .post('/api/projects')
    .send({
      name,
      description: 'Test project for join system',
      tags: ['test'],
      lookingFor: ['Tester'],
      projectType: 'research'
    });
  return res.body.project;
}

describe('POST /api/projects/:id/join (Join Request)', () => {
  test('should send join request', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: joiner } = await registerAndLogin(app);
    const res = await joiner
      .post(`/api/projects/${project.id}/join`)
      .send({ message: 'I want to join!' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('duplicate join request should return 400', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: joiner } = await registerAndLogin(app);
    await joiner.post(`/api/projects/${project.id}/join`).send({});

    const res = await joiner.post(`/api/projects/${project.id}/join`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pending');
  });

  test('creator should not join own project', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const res = await creator.post(`/api/projects/${project.id}/join`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("can't join your own");
  });

  test('unauthenticated should return 401', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const res = await request(app)
      .post(`/api/projects/${project.id}/join`)
      .send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/projects/:id/requests (View Requests)', () => {
  test('creator should see pending requests', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: joiner } = await registerAndLogin(app);
    await joiner.post(`/api/projects/${project.id}/join`).send({ message: 'Hello' });

    const res = await creator.get(`/api/projects/${project.id}/requests`);
    expect(res.status).toBe(200);
    expect(res.body.requests.length).toBe(1);
  });

  test('non-creator should return 403', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: other } = await registerAndLogin(app);
    const res = await other.get(`/api/projects/${project.id}/requests`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/projects/:id/requests/:requestId (Accept/Reject)', () => {
  test('accept should add user as member', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: joiner } = await registerAndLogin(app);
    await joiner.post(`/api/projects/${project.id}/join`).send({});

    // Get the request ID
    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;

    // Accept
    const res = await creator
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'accept' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('accepted');

    // Verify member is added
    const membersRes = await creator.get(`/api/projects/${project.id}/members`);
    expect(membersRes.body.members.length).toBe(2); // creator + new member
  });

  test('reject should not add member', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: joiner } = await registerAndLogin(app);
    await joiner.post(`/api/projects/${project.id}/join`).send({});

    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;

    const res = await creator
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'reject' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('rejected');

    // Verify member is NOT added (only creator)
    const membersRes = await creator.get(`/api/projects/${project.id}/members`);
    expect(membersRes.body.members.length).toBe(1);
  });

  test('non-creator should return 403', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: joiner } = await registerAndLogin(app);
    await joiner.post(`/api/projects/${project.id}/join`).send({});

    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;

    const { agent: other } = await registerAndLogin(app);
    const res = await other
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'accept' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/projects/:id/leave (Leave Project)', () => {
  test('member should be able to leave', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    // Add a member
    const { agent: member } = await registerAndLogin(app);
    await member.post(`/api/projects/${project.id}/join`).send({});

    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;
    await creator
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'accept' });

    // Member leaves
    const res = await member.delete(`/api/projects/${project.id}/leave`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('creator should not be able to leave', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const res = await creator.delete(`/api/projects/${project.id}/leave`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('creator cannot leave');
  });
});

describe('DELETE /api/projects/:id/members/:memberId (Kick Member)', () => {
  test('creator should kick a member', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    // Add a member
    const { agent: member } = await registerAndLogin(app);
    await member.post(`/api/projects/${project.id}/join`).send({});

    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;
    await creator
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'accept' });

    // Get member ID
    const membersRes = await creator.get(`/api/projects/${project.id}/members`);
    const memberId = membersRes.body.members.find(m => m.role === 'member').user_id;

    // Kick
    const res = await creator.delete(`/api/projects/${project.id}/members/${memberId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('kicked member should not be able to rejoin', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: member } = await registerAndLogin(app);
    await member.post(`/api/projects/${project.id}/join`).send({});

    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;
    await creator
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'accept' });

    const membersRes = await creator.get(`/api/projects/${project.id}/members`);
    const memberId = membersRes.body.members.find(m => m.role === 'member').user_id;
    await creator.delete(`/api/projects/${project.id}/members/${memberId}`);

    // Kicked member tries to rejoin
    const res = await member.post(`/api/projects/${project.id}/join`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('removed');
  });

  test('non-creator should not kick', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: member } = await registerAndLogin(app);
    await member.post(`/api/projects/${project.id}/join`).send({});

    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;
    await creator
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'accept' });

    const membersRes = await creator.get(`/api/projects/${project.id}/members`);
    const memberId = membersRes.body.members.find(m => m.role === 'member').user_id;

    // Another user tries to kick
    const { agent: other } = await registerAndLogin(app);
    const res = await other.delete(`/api/projects/${project.id}/members/${memberId}`);
    expect(res.status).toBe(403);
  });
});

describe('Rejection cooldown (30 days)', () => {
  test('rejected user should not be able to rejoin immediately', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const project = await createProject(creator);

    const { agent: joiner } = await registerAndLogin(app);
    await joiner.post(`/api/projects/${project.id}/join`).send({});

    // Creator rejects the request
    const reqsRes = await creator.get(`/api/projects/${project.id}/requests`);
    const requestId = reqsRes.body.requests[0].id;
    await creator
      .patch(`/api/projects/${project.id}/requests/${requestId}`)
      .send({ action: 'reject' });

    // Joiner tries to rejoin immediately
    const res = await joiner.post(`/api/projects/${project.id}/join`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rejected|days/i);
  });
});
