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

// Helper to create a research project (no GitHub required)
async function createResearchProject(agent, overrides = {}) {
  const res = await agent
    .post('/api/projects')
    .send({
      name: overrides.name || 'Test Project',
      description: overrides.description || 'A test research project',
      tags: overrides.tags || ['research', 'test'],
      lookingFor: overrides.lookingFor || ['Researcher'],
      projectType: 'research'
    });
  return res;
}

describe('POST /api/projects (Create)', () => {
  test('should create a research project', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await createResearchProject(agent);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.project.name).toBe('Test Project');
    expect(res.body.project.projectType).toBe('research');
  });

  test('duplicate project name should return 400', async () => {
    const { agent } = await registerAndLogin(app);
    await createResearchProject(agent, { name: 'Duplicate' });
    const res = await createResearchProject(agent, { name: 'Duplicate' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already have an active project');
  });

  test('unauthenticated should return 401', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({
        name: 'No Auth',
        description: 'Should fail',
        tags: ['test'],
        lookingFor: ['dev'],
        projectType: 'research'
      });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/projects (User Projects)', () => {
  test('should list user projects', async () => {
    const { agent } = await registerAndLogin(app);
    await createResearchProject(agent, { name: 'Project A' });
    await createResearchProject(agent, { name: 'Project B' });

    const res = await agent.get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.projects.length).toBe(2);
  });

  test('unauthenticated should return 401', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/projects/:id (Single Project)', () => {
  test('should return a single project', async () => {
    const { agent } = await registerAndLogin(app);
    const createRes = await createResearchProject(agent);
    const projectId = createRes.body.project.id;

    const res = await agent.get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe(projectId);
  });

  test('non-existent project should return 404', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.get('/api/projects/550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(404);
  });

  test('invalid UUID should return 400', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.get('/api/projects/not-a-uuid');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/projects/:id (Update)', () => {
  test('creator should update project', async () => {
    const { agent } = await registerAndLogin(app);
    const createRes = await createResearchProject(agent);
    const projectId = createRes.body.project.id;

    const res = await agent
      .put(`/api/projects/${projectId}`)
      .send({
        name: 'Updated Name',
        description: 'Updated description',
        tags: ['updated'],
        lookingFor: ['Tester'],
        recruitmentOpen: false
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('non-creator should return 404', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const createRes = await createResearchProject(creator);
    const projectId = createRes.body.project.id;

    const { agent: other } = await registerAndLogin(app);
    const res = await other
      .put(`/api/projects/${projectId}`)
      .send({
        name: 'Hacked',
        description: 'Hacked desc',
        tags: ['hack'],
        lookingFor: ['Hacker'],
        recruitmentOpen: true
      });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/projects/:id/recruitment (Toggle)', () => {
  test('should toggle recruitment status', async () => {
    const { agent } = await registerAndLogin(app);
    const createRes = await createResearchProject(agent);
    const projectId = createRes.body.project.id;

    const res = await agent.patch(`/api/projects/${projectId}/recruitment`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('DELETE /api/projects/:id (Soft Delete)', () => {
  test('should soft delete project', async () => {
    const { agent } = await registerAndLogin(app);
    const createRes = await createResearchProject(agent);
    const projectId = createRes.body.project.id;

    const res = await agent.delete(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify project is deleted
    const getRes = await agent.get(`/api/projects/${projectId}`);
    expect(getRes.body.project.project_status).toBe('deleted');
  });

  test('non-creator should not delete', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const createRes = await createResearchProject(creator);
    const projectId = createRes.body.project.id;

    const { agent: other } = await registerAndLogin(app);
    const res = await other.delete(`/api/projects/${projectId}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/projects/discover', () => {
  test('should list active projects', async () => {
    const { agent } = await registerAndLogin(app);
    await createResearchProject(agent, { name: 'Discoverable' });

    // Anonymous user should see the project
    const res = await request(app).get('/api/projects/discover');
    expect(res.status).toBe(200);
    expect(res.body.projects.length).toBeGreaterThanOrEqual(1);
  });

  test('logged-in user should not see own projects in discover', async () => {
    const { agent } = await registerAndLogin(app);
    await createResearchProject(agent, { name: 'My Own Project' });

    const res = await agent.get('/api/projects/discover');
    expect(res.status).toBe(200);
    // User's own project should be filtered out
    const myProject = res.body.projects.find(p => p.name === 'My Own Project');
    expect(myProject).toBeUndefined();
  });
});

describe('PATCH /api/projects/:id/complete', () => {
  test('creator should complete project', async () => {
    const { agent } = await registerAndLogin(app);
    const createRes = await createResearchProject(agent);
    const projectId = createRes.body.project.id;

    const res = await agent.patch(`/api/projects/${projectId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify project status is completed and recruitment is closed
    const getRes = await agent.get(`/api/projects/${projectId}`);
    expect(getRes.body.project.project_status).toBe('completed');
  });

  test('non-creator should not complete project', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const createRes = await createResearchProject(creator);
    const projectId = createRes.body.project.id;

    const { agent: other } = await registerAndLogin(app);
    const res = await other.patch(`/api/projects/${projectId}/complete`);
    expect(res.status).toBe(404);
  });

  test('already completed project should return 404', async () => {
    const { agent } = await registerAndLogin(app);
    const createRes = await createResearchProject(agent);
    const projectId = createRes.body.project.id;

    // Complete once
    await agent.patch(`/api/projects/${projectId}/complete`);

    // Try to complete again
    const res = await agent.patch(`/api/projects/${projectId}/complete`);
    expect(res.status).toBe(404);
  });
});
