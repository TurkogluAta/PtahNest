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

async function createResearchProject(agent, name = 'Kick Test') {
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

describe('Kick voting — start vote', () => {
  test('creator can start kick vote against member', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);
    const memberId = await getMemberId(member);

    const res = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: memberId });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('non-creator/mod cannot start kick vote', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member1 } = await registerAndLogin(app);
    const { agent: member2 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member1);
    await joinAsMember(creator, projectId, member2);
    const member2Id = await getMemberId(member2);

    const res = await member1.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: member2Id });
    expect(res.status).toBe(403);
  });

  test('cannot start kick vote against self', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    const creatorId = await getMemberId(creator);

    const res = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: creatorId });
    expect(res.status).toBe(400);
  });

  test('cannot start two open votes against same target', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: member } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, member);
    const memberId = await getMemberId(member);

    await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: memberId });
    const res = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: memberId });
    expect(res.status).toBe(409);
  });
});

describe('Kick voting — cast ballot', () => {
  test('eligible voter can cast yes ballot', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);
    const m1Id = await getMemberId(m1);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m1Id });
    const voteId = startRes.body.vote.id;

    const res = await m2.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });
    expect(res.status).toBe(200);
  });

  test('target cannot vote on their own kick', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    const m1Id = await getMemberId(m1);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m1Id });
    const voteId = startRes.body.vote.id;

    const res = await m1.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });
    expect(res.status).toBe(403);
  });

  test('non-member cannot cast ballot', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: outsider } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    const m1Id = await getMemberId(m1);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m1Id });
    const voteId = startRes.body.vote.id;

    const res = await outsider.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });
    expect([403, 404]).toContain(res.status);
  });

  test('research project: 70% threshold passes vote', async () => {
    // 4 members: creator + 3 others. Target = m3. Eligible = creator + m1 + m2 (3 voters)
    // 70% of 3 = 2.1, so 3 yes votes → pass
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const { agent: m3 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);
    await joinAsMember(creator, projectId, m3);
    const m3Id = await getMemberId(m3);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m3Id });
    const voteId = startRes.body.vote.id;

    await creator.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });
    await m1.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });
    const res = await m2.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });

    expect(res.body.voteStatus).toBe('passed');

    // Verify member is kicked
    const members = await creator.get(`/api/projects/${projectId}/members`);
    const m3Member = members.body.members.find(m => m.user_id === m3Id);
    expect(m3Member).toBeUndefined();
  });

  test('research project: below 70% does not pass', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const { agent: m3 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);
    await joinAsMember(creator, projectId, m3);
    const m3Id = await getMemberId(m3);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m3Id });
    const voteId = startRes.body.vote.id;

    // Only 1 yes (33%) — should not pass
    const res = await creator.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });
    expect(res.body.voteStatus).toBe('open');
  });

  test('voting twice rejected (vote is locked once cast)', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);
    const m2Id = await getMemberId(m2);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m2Id });
    const voteId = startRes.body.vote.id;

    const first = await m1.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'yes' });
    expect(first.status).toBe(200);

    const second = await m1.post(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`).send({ ballot: 'no' });
    expect(second.status).toBe(400);
  });
});

describe('Kick voting — cancel & list', () => {
  test('creator can cancel open vote', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    const m1Id = await getMemberId(m1);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m1Id });
    const voteId = startRes.body.vote.id;

    const res = await creator.post(`/api/projects/${projectId}/kick-votes/${voteId}/cancel`);
    expect(res.status).toBe(200);
  });

  test('non-creator cannot cancel vote', async () => {
    const { agent: creator } = await registerAndLogin(app);
    const { agent: m1 } = await registerAndLogin(app);
    const { agent: m2 } = await registerAndLogin(app);
    const projectId = await createResearchProject(creator);
    await joinAsMember(creator, projectId, m1);
    await joinAsMember(creator, projectId, m2);
    const m2Id = await getMemberId(m2);

    const startRes = await creator.post(`/api/projects/${projectId}/kick-votes`).send({ targetUserId: m2Id });
    const voteId = startRes.body.vote.id;

    const res = await m1.post(`/api/projects/${projectId}/kick-votes/${voteId}/cancel`);
    expect(res.status).toBe(403);
  });
});
