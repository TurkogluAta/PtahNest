const request = require('supertest');
const app = require('../../app');
const { setupDatabase, cleanDatabase, registerAndLogin, pool } = require('../helpers');
const { encrypt } = require('../../src/utils/encryption');

beforeAll(async () => {
  await setupDatabase();
  await cleanDatabase();
});

afterEach(async () => {
  await cleanDatabase();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await pool.end();
});

// Helper: Link a GitHub account to a user directly in DB
async function linkGithub(userId, githubId = 12345, githubUsername = 'testghuser') {
  const encryptedToken = encrypt('gho_fake_token_for_testing');
  await pool.query(
    'UPDATE users SET github_id = $1, github_username = $2, github_token = $3 WHERE id = $4',
    [githubId, githubUsername, encryptedToken, userId]
  );
}

// Helper: Get user ID from session agent
async function getUserId(agent) {
  const res = await agent.get('/api/auth/me');
  return res.body.user.id;
}

// Helper: Create a software project with linked GitHub
async function createSoftwareProject(agent, userId, name = 'SoftProj') {
  await linkGithub(userId, Math.floor(Math.random() * 100000));

  // Mock GitHub API for repo creation
  const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    status: 201,
    ok: true,
    json: async () => ({ full_name: `testghuser/${name}` })
  });

  const res = await agent
    .post('/api/projects')
    .send({
      name,
      description: 'A software project',
      tags: ['nodejs'],
      lookingFor: ['Developer'],
      projectType: 'software'
    });

  mockFetch.mockRestore();
  return res;
}

describe('GET /api/github/status', () => {
  test('should return linked: false when no GitHub linked', async () => {
    const { agent } = await registerAndLogin(app);

    const res = await agent.get('/api/github/status');
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(false);
  });

  test('should return linked: true after linking GitHub', async () => {
    const { agent } = await registerAndLogin(app);
    const userId = await getUserId(agent);
    await linkGithub(userId);

    const res = await agent.get('/api/github/status');
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.github_username).toBe('testghuser');
  });

  test('unauthenticated should return 401', async () => {
    const res = await request(app).get('/api/github/status');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/github/unlink', () => {
  test('should unlink GitHub when no active software projects', async () => {
    const { agent } = await registerAndLogin(app);
    const userId = await getUserId(agent);
    await linkGithub(userId);

    const res = await agent.post('/api/github/unlink');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify unlinked
    const statusRes = await agent.get('/api/github/status');
    expect(statusRes.body.linked).toBe(false);
  });

  test('should block unlink when creator of active software project', async () => {
    const { agent } = await registerAndLogin(app);
    const userId = await getUserId(agent);
    await createSoftwareProject(agent, userId, 'BlockUnlink');

    const res = await agent.post('/api/github/unlink');
    expect(res.status).toBe(400);
    expect(res.body.blockedByCreator).toBe(true);
  });

  test('should return 400 when no GitHub linked', async () => {
    const { agent } = await registerAndLogin(app);

    const res = await agent.post('/api/github/unlink');
    expect(res.status).toBe(400);
  });
});

describe('GitHub API Mock Tests', () => {
  test('createGithubRepo should handle success (mock 201)', async () => {
    const { agent } = await registerAndLogin(app);
    const userId = await getUserId(agent);
    await linkGithub(userId);

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => ({ full_name: 'testghuser/new-repo' })
    });

    const res = await agent
      .post('/api/projects')
      .send({
        name: 'NewRepoProject',
        description: 'Auto-create repo test',
        tags: ['test'],
        lookingFor: ['dev'],
        projectType: 'software'
      });

    expect(res.status).toBe(201);
    expect(res.body.project.githubRepo).toBe('testghuser/new-repo');
  });

  test('createGithubRepo duplicate should return 400 (mock 422)', async () => {
    const { agent } = await registerAndLogin(app);
    const userId = await getUserId(agent);
    await linkGithub(userId);

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      status: 422,
      ok: false,
      json: async () => ({ message: 'Repository creation failed.' })
    });

    const res = await agent
      .post('/api/projects')
      .send({
        name: 'DuplicateRepo',
        description: 'Duplicate repo test',
        tags: ['test'],
        lookingFor: ['dev'],
        projectType: 'software'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already exists');
  });

  test('sendCollaboratorInvite should work (mock invite + auto-accept)', async () => {
    const { sendCollaboratorInvite } = require('../../src/routes/githubRoutes');

    const { agent: creatorAgent } = await registerAndLogin(app);
    const creatorId = await getUserId(creatorAgent);
    await linkGithub(creatorId, 11111, 'creator_gh');

    const { agent: memberAgent } = await registerAndLogin(app);
    const memberId = await getUserId(memberAgent);
    await linkGithub(memberId, 22222, 'member_gh');

    // Create a research project first (no GitHub needed)
    const createRes = await creatorAgent
      .post('/api/projects')
      .send({
        name: 'InviteTest',
        description: 'Test invite',
        tags: ['test'],
        lookingFor: ['dev'],
        projectType: 'research'
      });
    const projectId = createRes.body.project.id;

    // Mock GitHub API calls for invite
    const fetchMock = jest.spyOn(global, 'fetch')
      // PUT collaborators (send invite) -> 201
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({})
      })
      // GET repository_invitations -> list with our invite
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          id: 999,
          repository: { full_name: 'creator_gh/InviteTest' }
        }])
      })
      // PATCH accept invite -> 204
      .mockResolvedValueOnce({
        status: 204,
        ok: true
      });

    const result = await sendCollaboratorInvite(projectId, memberId, 'creator_gh/InviteTest', creatorId, 22222);

    expect(result.sent).toBe(true);
    expect(result.autoAccepted).toBe(true);
  });

  test('removeGithubCollaborator should return removed (mock 204)', async () => {
    const { removeGithubCollaborator } = require('../../src/routes/githubRoutes');

    const { agent: creatorAgent } = await registerAndLogin(app);
    const creatorId = await getUserId(creatorAgent);
    await linkGithub(creatorId, 33333, 'owner_gh');

    // Mock: resolve username from GitHub ID, then remove collaborator
    jest.spyOn(global, 'fetch')
      // GET /user/:id (resolve username)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: 'kicked_user' })
      })
      // DELETE collaborator -> 204
      .mockResolvedValueOnce({
        status: 204,
        ok: true
      });

    const result = await removeGithubCollaborator(44444, 'owner_gh/some-repo', creatorId);
    expect(result.removed).toBe(true);
  });
});

describe('GET /api/github/repos', () => {
  test('should return repo list when GitHub is linked', async () => {
    const { agent } = await registerAndLogin(app);
    const userId = await getUserId(agent);
    await linkGithub(userId);

    // Mock GitHub repos API
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { full_name: 'testghuser/repo-a', private: false, owner: { login: 'testghuser' } },
        { full_name: 'testghuser/repo-b', private: true, owner: { login: 'testghuser' } }
      ])
    });

    const res = await agent.get('/api/github/repos');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.repos).toHaveLength(2);
    expect(res.body.repos[0].full_name).toBe('testghuser/repo-a');
  });

  test('should return empty array when GitHub is not linked', async () => {
    const { agent } = await registerAndLogin(app);

    const res = await agent.get('/api/github/repos');
    expect(res.status).toBe(200);
    expect(res.body.repos).toEqual([]);
  });
});

describe('GET /api/github/commits/:projectId', () => {
  test('non-existent project should return 404', async () => {
    const { agent } = await registerAndLogin(app);

    const res = await agent.get('/api/github/commits/550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(404);
  });

  test('non-member should return 403', async () => {
    // Create a project with one user
    const { agent: creator } = await registerAndLogin(app);
    const createRes = await creator
      .post('/api/projects')
      .send({
        name: 'CommitTestProj',
        description: 'Test project for commits',
        tags: ['test'],
        lookingFor: ['dev'],
        projectType: 'research'
      });
    const projectId = createRes.body.project.id;

    // Another user (not a member) tries to fetch commits
    const { agent: outsider } = await registerAndLogin(app);
    const res = await outsider.get(`/api/github/commits/${projectId}`);
    expect(res.status).toBe(403);
  });

  test('project without github_repo should return empty commits', async () => {
    const { agent } = await registerAndLogin(app);
    const userId = await getUserId(agent);
    await linkGithub(userId);

    // Create a research project (no GitHub repo)
    const createRes = await agent
      .post('/api/projects')
      .send({
        name: 'NoRepoProj',
        description: 'Research project without repo',
        tags: ['test'],
        lookingFor: ['dev'],
        projectType: 'research'
      });
    const projectId = createRes.body.project.id;

    const res = await agent.get(`/api/github/commits/${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body.commits).toEqual([]);
    expect(res.body.totalCount).toBe(0);
  });
});
