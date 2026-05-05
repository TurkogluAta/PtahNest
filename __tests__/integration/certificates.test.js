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

async function createResearchProject(agent, name = 'Cert Test Project') {
  const res = await agent.post('/api/projects').send({
    name, description: 'desc', tags: ['t'], lookingFor: ['r'], projectType: 'research'
  });
  return res.body.project.id;
}

async function joinAsMember(creatorAgent, projectId, memberAgent) {
  await memberAgent.post(`/api/projects/${projectId}/join`).send({});
  const reqList = await creatorAgent.get(`/api/projects/${projectId}/requests`);
  const reqId = reqList.body.requests[0].id;
  await creatorAgent.patch(`/api/projects/${projectId}/requests/${reqId}`).send({ action: 'accept' });
}

describe('Certificate triggers', () => {
  test('completing project issues certificates for all active members', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);

    await creator.patch(`/api/projects/${projectId}/complete`);

    // Wait briefly for fire-and-forget cert creation
    await new Promise(r => setTimeout(r, 200));

    const creatorCerts = await creator.get('/api/certificates/me');
    const memberCerts = await member.get('/api/certificates/me');
    expect(creatorCerts.body.data.certificates.length).toBe(1);
    expect(memberCerts.body.data.certificates.length).toBe(1);
    expect(creatorCerts.body.data.certificates[0].trigger_type).toBe('completed');
    expect(creatorCerts.body.data.certificates[0].was_creator).toBe(true);
    expect(memberCerts.body.data.certificates[0].was_creator).toBe(false);
  });

  test('leaving project issues certificate only to leaver', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);

    await member.delete(`/api/projects/${projectId}/leave`);
    await new Promise(r => setTimeout(r, 200));

    const creatorCerts = await creator.get('/api/certificates/me');
    const memberCerts = await member.get('/api/certificates/me');
    expect(creatorCerts.body.data.certificates.length).toBe(0);
    expect(memberCerts.body.data.certificates.length).toBe(1);
    expect(memberCerts.body.data.certificates[0].trigger_type).toBe('left');
  });

  test('deleting project issues certificates for all active members', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);

    await creator.delete(`/api/projects/${projectId}`);
    await new Promise(r => setTimeout(r, 200));

    const creatorCerts = await creator.get('/api/certificates/me');
    const memberCerts = await member.get('/api/certificates/me');
    expect(creatorCerts.body.data.certificates.length).toBe(1);
    expect(memberCerts.body.data.certificates.length).toBe(1);
    expect(creatorCerts.body.data.certificates[0].trigger_type).toBe('deleted');
  });

  test('duplicate certificate not created on repeated trigger', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);

    await creator.patch(`/api/projects/${projectId}/complete`);
    await new Promise(r => setTimeout(r, 200));

    // Force a duplicate trigger via direct DB call to certificateBuilder
    const { triggerForMember } = require('../../src/services/certificateBuilder');
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    await triggerForMember(userRes.rows[0].id, projectId, 'completed');

    const certs = await creator.get('/api/certificates/me');
    expect(certs.body.data.certificates.length).toBe(1);
  });
});

describe('GET /api/certificates/me', () => {
  test('unauthenticated returns 401', async () => {
    const res = await request(app).get('/api/certificates/me');
    expect(res.status).toBe(401);
  });

  test('returns empty array for user with no certificates', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.get('/api/certificates/me');
    expect(res.status).toBe(200);
    expect(res.body.data.certificates).toEqual([]);
  });
});

describe('GET /api/certificates/:id', () => {
  test('owner can fetch own certificate', async () => {
    const { agent } = await registerAndLogin(app);
    const projectId = await createResearchProject(agent);
    await agent.patch(`/api/projects/${projectId}/complete`);
    await new Promise(r => setTimeout(r, 200));

    const list = await agent.get('/api/certificates/me');
    const certId = list.body.data.certificates[0].id;
    const res = await agent.get(`/api/certificates/${certId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.certificate.id).toBe(certId);
  });

  test('non-owner cannot fetch certificate', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: other } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await creator.patch(`/api/projects/${projectId}/complete`);
    await new Promise(r => setTimeout(r, 200));

    const list = await creator.get('/api/certificates/me');
    const certId = list.body.data.certificates[0].id;
    const res = await other.get(`/api/certificates/${certId}`);
    expect(res.status).toBe(403);
  });

  test('invalid UUID returns 400', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.get('/api/certificates/not-a-uuid');
    expect(res.status).toBe(400);
  });

  test('non-existent certificate returns 404', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.get('/api/certificates/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/certificates/verify/:id (public)', () => {
  test('public verify works without auth', async () => {
    const { agent } = await registerAndLogin(app);
    const projectId = await createResearchProject(agent);
    await agent.patch(`/api/projects/${projectId}/complete`);
    await new Promise(r => setTimeout(r, 200));

    const list = await agent.get('/api/certificates/me');
    const certId = list.body.data.certificates[0].id;

    const res = await request(app).get(`/api/certificates/verify/${certId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.certificate.project_name).toBeTruthy();
  });

  test('non-existent certificate returns 404', async () => {
    const res = await request(app).get('/api/certificates/verify/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('Dev endpoints', () => {
  test('non-adminAta user cannot reset mock', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/certificates/dev/reset-mock');
    expect(res.status).toBe(403);
  });

  test('unauthenticated cannot seed mock', async () => {
    const res = await request(app).post('/api/certificates/dev/seed-mock');
    expect(res.status).toBe(401);
  });
});
