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

async function createResearchProject(agent, name = 'Chat Todo Test') {
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

async function getMemberId(agent) {
  const me = await agent.get('/api/auth/me');
  return me.body.user.id;
}

describe('Project chat', () => {
  test('member can post and read messages', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);

    const post = await creator.post(`/api/projects/${projectId}/messages`).send({ content: 'hello team' });
    expect(post.status).toBe(200);

    const get = await creator.get(`/api/projects/${projectId}/messages`);
    expect(get.status).toBe(200);
    expect(get.body.messages.length).toBe(1);
    expect(get.body.messages[0].content).toBe('hello team');
  });

  test('non-member cannot post messages', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: outsider } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);

    const res = await outsider.post(`/api/projects/${projectId}/messages`).send({ content: 'sneaky' });
    expect([400, 403, 404]).toContain(res.status);
  });

  test('empty message rejected', async () => {
    const { agent } = await registerAndLogin(app);
    const projectId = await createResearchProject(agent);
    const res = await agent.post(`/api/projects/${projectId}/messages`).send({ content: '' });
    expect(res.status).toBe(400);
  });

  test('message stored encrypted in DB but returned decrypted', async () => {
    const { agent } = await registerAndLogin(app);
    const projectId = await createResearchProject(agent);
    await agent.post(`/api/projects/${projectId}/messages`).send({ content: 'secret123' });

    const dbRow = await pool.query('SELECT encrypted_content FROM project_messages WHERE project_id = $1', [projectId]);
    expect(dbRow.rows[0].encrypted_content).not.toContain('secret123');

    const get = await agent.get(`/api/projects/${projectId}/messages`);
    expect(get.body.messages[0].content).toBe('secret123');
  });
});

describe('Project todos — CRUD', () => {
  test('member can create todo without assignee', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);

    const res = await member.post(`/api/projects/${projectId}/todos`).send({
      title: 'Self todo', description: 'no assignee', dueDate: '2026-12-31'
    });
    expect(res.status).toBe(201);
  });

  test('member cannot assign todo to others', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);
    const m2Id = await getMemberId(m2);

    const res = await m1.post(`/api/projects/${projectId}/todos`).send({
      title: 'Assign attempt', dueDate: '2026-12-31', assignedTo: m2Id
    });
    expect(res.status).toBe(403);
  });

  test('creator can assign todo to member', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);
    const memberId = await getMemberId(member);

    const res = await creator.post(`/api/projects/${projectId}/todos`).send({
      title: 'Do it', dueDate: '2026-12-31', assignedTo: memberId
    });
    expect(res.status).toBe(201);

    const list = await creator.get(`/api/projects/${projectId}/todos`);
    expect(list.body.todos[0].assigned_to).toBe(memberId);
  });

  test('assignee can toggle complete', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);
    const memberId = await getMemberId(member);

    const created = await creator.post(`/api/projects/${projectId}/todos`).send({
      title: 'Assigned', dueDate: '2026-12-31', assignedTo: memberId
    });
    const todoId = created.body.id;

    const res = await member.patch(`/api/projects/${projectId}/todos/${todoId}`);
    expect(res.status).toBe(200);

    const list = await member.get(`/api/projects/${projectId}/todos`);
    expect(list.body.todos[0].completed).toBe(true);
  });

  test('non-assignee non-author non-mgmt cannot toggle', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);
    const m1Id = await getMemberId(m1);

    const created = await creator.post(`/api/projects/${projectId}/todos`).send({
      title: 'For m1', dueDate: '2026-12-31', assignedTo: m1Id
    });
    const todoId = created.body.id;

    // m2 is not assignee/author/mgmt
    const res = await m2.patch(`/api/projects/${projectId}/todos/${todoId}`);
    expect(res.status).toBe(403);
  });

  test('author can delete own todo', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);

    const created = await member.post(`/api/projects/${projectId}/todos`).send({
      title: 'Mine', dueDate: '2026-12-31'
    });
    const todoId = created.body.id;

    const res = await member.delete(`/api/projects/${projectId}/todos/${todoId}`);
    expect(res.status).toBe(200);
  });

  test('non-author non-mgmt cannot delete', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);

    const created = await m1.post(`/api/projects/${projectId}/todos`).send({
      title: 'M1 Todo', dueDate: '2026-12-31'
    });
    const todoId = created.body.id;

    const res = await m2.delete(`/api/projects/${projectId}/todos/${todoId}`);
    expect(res.status).toBe(403);
  });

  test('listing todos returns all project todos for member', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await creator.post(`/api/projects/${projectId}/todos`).send({ title: 'A', dueDate: '2026-12-31' });
    await creator.post(`/api/projects/${projectId}/todos`).send({ title: 'B', dueDate: '2026-12-31' });

    const res = await creator.get(`/api/projects/${projectId}/todos`);
    expect(res.status).toBe(200);
    expect(res.body.todos.length).toBe(2);
  });
});
