// Get project ID from URL
const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');

if (!projectId) {
    showToast('No project ID provided', 'error');
    setTimeout(() => { window.location.href = '/pages/projects.html'; }, 1500);
}

// State
let project = null;
let members = [];
let currentUserId = null;
let currentUserRole = null; // 'creator' | 'moderator' | 'member'
let projectChatPolling = null;
let todos = [];
let todoFilter = 'all'; // 'all' | 'open' | 'done'
let todoPage = 1;
const TODOS_PER_PAGE = 5;
let todoExpanded = false; // collapsed: preview (top 3 open) ; expanded: full list+filter+pagination
const TODO_PREVIEW_COUNT = 3;

// Fetch project details
async function fetchProjectDetails() {
    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch project');
        }

        const data = await response.json();
        project = data.project;

        // Render header
        renderProjectHeader();

        // Fetch members and commits
        await fetchMembers();
        fetchCommits(1);

    } catch (error) {
        console.error('Fetch project error:', error);
        showToast('Failed to load project. Redirecting...', 'error');
        setTimeout(() => { window.location.href = '/pages/projects.html'; }, 1500);
    }
}

// Fetch members
async function fetchMembers() {
    try {
        const response = await fetch(`/api/projects/${projectId}/members`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            const data = await response.json();
            members = data.members;
            currentUserId = data.currentUserId;
            // Determine current user's role from members list
            const me = members.find(m => m.user_id === currentUserId);
            if (project && project.creator_id === currentUserId) {
                currentUserRole = 'creator';
            } else if (me) {
                currentUserRole = me.role; // 'moderator' or 'member'
            }
            renderMembers();
            renderProjectDetails();
            renderActions();
            initTabBar();
            loadKickVotes(); // active votes visible to all members
            renderLeaderboard(); // mock leaderboard, fallback data if no commits yet
        } else {
            // User not authorized to view members
            const data = await response.json();
            showToast(data.message || 'You are not authorized to view this project', 'error');
            setTimeout(() => { window.location.href = '/pages/projects.html'; }, 1500);
        }
    } catch (error) {
        console.error('Fetch members error:', error);
        showToast('Failed to load project members', 'error');
    }
}

// Render project header
function renderProjectHeader() {
    // Repo badge for software projects with a linked GitHub repo
    const repoTagHTML = project.projectType === 'software' && project.githubRepo
        ? `<span class="repo-tag"><img src="../pictures/icons/github.svg" width="14" height="14">${project.githubRepo}</span>`
        : '';

    const headerHTML = `
        <div class="flex-between-start">
            <div>
                <h1 class="hero-title">${project.name}</h1>
                <p class="text-muted">${project.description || 'No description provided.'}</p>
            </div>
            <div class="badge-group">
                ${project.status === 'completed' && project.role === 'creator' ? '<img src="../pictures/icons/purple-star.svg" width="20" height="20" title="Project Creator">' : ''}
                ${repoTagHTML}
                <span class="badge ${getBadgeClass(project.status)}">${getBadgeText(project.status)}</span>
            </div>
        </div>
    `;
    document.getElementById('projectHeader').innerHTML = headerHTML;
}

// Render project details
function renderProjectDetails() {
    const tagsHTML = project.tags && project.tags.length > 0
        ? `<div class="section-block">
             <div class="input-label">Tags</div>
             <div class="project-tags">${project.tags.map(tag => `<span class="project-tag">${tag}</span>`).join('')}</div>
           </div>`
        : '';

    const lookingForHTML = project.lookingFor && project.lookingFor.length > 0
        ? `<div class="section-block">
             <div class="input-label">Looking For</div>
             <div class="project-looking-for project-looking-for-flush">
               ${project.lookingFor.map(role => `<span class="role-tag">${role}</span>`).join('')}
             </div>
           </div>`
        : '';

    const detailsHTML = `
        <div>
            <div class="input-label">About This Project</div>
            <p class="card-desc">${project.description}</p>
        </div>
        ${tagsHTML}
        ${lookingForHTML}
        <div class="section-block">
            <div class="input-label">Project Info</div>
            <div class="project-meta project-meta-sm">
                <span class="meta-inline">
                    <img src="../pictures/icons/members.svg" width="16">
                    ${members.length} Members
                </span>
                <span class="meta-inline">
                    Recruitment: ${project.recruitmentOpen ? 'Open' : 'Closed'}
                </span>
                <span class="meta-inline">
                    Created ${formatDate(project.created_at)}
                </span>
            </div>
        </div>
    `;

    document.getElementById('projectDetails').innerHTML = detailsHTML;
}

// Render members list
const TEAM_MEMBERS_PER_PAGE = 5;
let teamMembersPage = 1;
let teamMembersOpen = false;

function toggleTeamMembers() {
    teamMembersOpen = !teamMembersOpen;
    document.getElementById('teamMembersPanel').classList.toggle('open', teamMembersOpen);
    document.getElementById('teamMembersChevron').classList.toggle('rotated', teamMembersOpen);
}

function renderMembers() {
    teamMembersPage = 1;
    renderTeamMembersPage();
}

function renderTeamMembersPage() {
    const container = document.getElementById('membersContainer');
    if (!container) return;

    if (members.length === 0) {
        container.innerHTML = `
            <div class="card">
                <p class="text-muted">No members yet</p>
            </div>
        `;
        return;
    }

    const totalPages = Math.ceil(members.length / TEAM_MEMBERS_PER_PAGE);
    const start = (teamMembersPage - 1) * TEAM_MEMBERS_PER_PAGE;
    const slice = members.slice(start, start + TEAM_MEMBERS_PER_PAGE);

    const membersHTML = slice.map(member => {
        const roleLabel = member.role === 'creator' ? 'Project Creator'
            : member.role === 'moderator' ? 'Moderator'
            : 'Team Member';

        const badgeHTML = member.role === 'creator'
            ? '<span class="badge badge-success">Creator</span>'
            : member.role === 'moderator'
            ? '<span class="badge badge-info">Mod</span>'
            : '';

        // Only show GitHub handle for software projects
        const githubHTML = (project && project.projectType === 'software' && member.github_username)
            ? `<a href="https://github.com/${member.github_username}" target="_blank" rel="noopener" class="member-github">
                   <img src="../pictures/icons/github.svg" width="12" height="12">${member.github_username}
               </a>`
            : '';

        return `
            <div class="member-row">
                <div class="member-row-info">
                    <div class="member-row-top">
                        <span class="member-name">${member.username}</span>
                        <span class="member-role-inline">${roleLabel}</span>
                    </div>
                    <div class="member-row-meta">
                        ${githubHTML}
                        <span class="member-joined-inline">Joined ${formatDate(member.joined_at)}</span>
                    </div>
                </div>
                <div class="member-actions">
                    ${badgeHTML}
                </div>
            </div>
        `;
    }).join('');

    const pagination = totalPages > 1 ? `
        <div class="health-pagination">
            <button class="health-page-btn" onclick="changeTeamMembersPage(${teamMembersPage - 1})" ${teamMembersPage === 1 ? 'disabled' : ''}>←</button>
            <span class="health-page-info">${teamMembersPage}/${totalPages} <span class="health-page-count">(${members.length} members)</span></span>
            <button class="health-page-btn" onclick="changeTeamMembersPage(${teamMembersPage + 1})" ${teamMembersPage === totalPages ? 'disabled' : ''}>→</button>
        </div>
    ` : '';

    container.innerHTML = membersHTML + pagination;
}

function changeTeamMembersPage(page) {
    const totalPages = Math.ceil(members.length / TEAM_MEMBERS_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    teamMembersPage = page;
    renderTeamMembersPage();
}

// ========================================
// TAB SYSTEM
// ========================================

function initTabBar() {
    const isManagement = currentUserRole === 'creator' || currentUserRole === 'moderator';
    const isMember = !!currentUserRole; // any active role

    if (isMember && project.status === 'active') {
        document.getElementById('tabBar').style.display = 'block';

        if (isManagement) {
            document.getElementById('adminTab').style.display = '';
            loadAdminPanel();
        }

        // Switch to tab specified in URL param
        const tabParam = urlParams.get('tab');
        if (tabParam === 'admin' && isManagement) switchDetailTab('admin');
        else if (tabParam === 'team' || tabParam === 'chat' || tabParam === 'todo') switchDetailTab('team');
    }
}

function switchDetailTab(tab) {
    // Stop chat polling when leaving team tab
    if (tab !== 'team' && projectChatPolling) {
        clearInterval(projectChatPolling);
        projectChatPolling = null;
    }

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');
    document.getElementById(tab + 'Content').classList.add('active');

    // Load chat + todos when entering team tab
    if (tab === 'team') {
        fetchProjectMessages();
        fetchTodos();
        if (!projectChatPolling) {
            projectChatPolling = setInterval(fetchProjectMessages, 3000);
        }
    }
}

// ========================================
// ADMIN PANEL
// ========================================

async function loadAdminPanel() {
    updateRecruitStatus();
    await Promise.all([
        loadAdminRequests(),
        loadKickVotes(),
        loadProjectHealth()
    ]);
    if (currentUserRole === 'creator') {
        document.getElementById('moderatorSection').style.display = 'block';
        loadModerators();
    }
}

function toggleRequests() {
    requestsOpen = !requestsOpen;
    const panel = document.getElementById('requestsPanel');
    const chevron = document.getElementById('requestsChevron');
    panel.classList.toggle('open', requestsOpen);
    chevron.classList.toggle('rotated', requestsOpen);
}

function updateRequestsDot(count) {
    const dot = document.getElementById('requestsStatusDot');
    if (!dot) return;
    dot.className = 'health-status-dot ' + (count > 0 ? 'dot-warn' : 'dot-ok');
}

// Block 1: Pending Join Requests
async function loadAdminRequests() {
    try {
        const res = await fetch(`/api/projects/${projectId}/requests`);
        const data = await res.json();
        const container = document.getElementById('adminRequestsContainer');
        // Red dot on Admin Panel tab if there are pending requests

        const hasPending = data.success && data.requests.length > 0;
        updateRequestsDot(hasPending ? data.requests.length : 0);

        if (!data.success || data.requests.length === 0) {
            container.innerHTML = '<div class="card card-sm"><p class="text-muted">No pending requests.</p></div>';
            return;
        }
        allRequests = data.requests;
        requestsPage = 1;
        renderRequestsPage();
    } catch (e) {
        document.getElementById('adminRequestsContainer').innerHTML = '<p class="text-muted">Failed to load requests.</p>';
    }
}

function renderRequestsPage() {
    const container = document.getElementById('adminRequestsContainer');
    const total = allRequests.length;
    const totalPages = Math.ceil(total / REQUESTS_PER_PAGE);
    const start = (requestsPage - 1) * REQUESTS_PER_PAGE;
    const slice = allRequests.slice(start, start + REQUESTS_PER_PAGE);

    const cards = slice.map(r => {
        const hasGithub = !!r.github_id;
        const mgmtCount = parseInt(r.management_message_count || 0);
        const lastFromApplicant = r.last_message_sender_id === r.user_id;
        const chatStatus = mgmtCount === 0
            ? '<span class="req-chat-status req-chat-new">New</span>'
            : lastFromApplicant
                ? '<span class="req-chat-status req-chat-new">New Reply</span>'
                : '<span class="req-chat-status req-chat-waiting">Waiting</span>';

        // Mock applicant score — stable per request id (TODO: replace with real score)
        const mockScore = (((parseInt(r.id.replace(/[^0-9]/g, '').slice(0, 4) || '1', 10) % 41) + 10) / 10);

        return `
        <div class="card card-sm card-bottom-gap req-card" onclick="openRequestDetail('${r.id}','${escapeHtml(r.username)}','${r.user_id}')">
            <div class="req-card-top">
                <div class="req-card-left">
                    <div class="req-card-name-row">
                        <span class="member-name">${escapeHtml(r.username)}</span>
                        ${renderCommitRating(mockScore)}
                    </div>
                    <div class="req-card-meta">
                        ${hasGithub ? `<span class="req-meta-badge"><img src="../pictures/icons/github.svg" width="11" height="11"> ${escapeHtml(r.github_username || 'GitHub')}</span>` : ''}
                        <span class="req-meta-date">${formatDate(r.created_at)}</span>
                    </div>
                </div>
                <div class="req-card-right">
                    ${chatStatus}
                </div>
            </div>
            ${r.message ? `<div class="req-card-message">"${escapeHtml(r.message)}"</div>` : ''}
        </div>`;
    }).join('');

    const pagination = totalPages > 1 ? `
        <div class="health-pagination">
            <button class="health-page-btn" onclick="changeRequestsPage(${requestsPage - 1})" ${requestsPage === 1 ? 'disabled' : ''}>←</button>
            <span class="health-page-info">${requestsPage}/${totalPages} <span class="health-page-count">(${total} requests)</span></span>
            <button class="health-page-btn" onclick="changeRequestsPage(${requestsPage + 1})" ${requestsPage === totalPages ? 'disabled' : ''}>→</button>
        </div>
    ` : '';

    container.innerHTML = cards + pagination;
}

function changeRequestsPage(page) {
    const totalPages = Math.ceil(allRequests.length / REQUESTS_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    requestsPage = page;
    renderRequestsPage();
}

async function handleRequest(requestId, action, username) {
    try {
        const res = await fetch(`/api/projects/${projectId}/requests/${requestId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(action === 'accept' ? `${username} added to project` : `Request from ${username} rejected`, 'success');
            loadAdminRequests();
            fetchMembers();
            if (typeof fetchNotifRequests === 'function') fetchNotifRequests();
        } else {
            showToast(data.message || 'Failed to process request', 'error');
        }
    } catch (e) {
        showToast('Failed to process request', 'error');
    }
}

// Block 2: Moderator management — collapsible + pagination
const MOD_TABLE_PER_PAGE = 5;
let modsOpen = false;
let modsPage = 1;
let regularMembersPage = 1;

function toggleModerators() {
    modsOpen = !modsOpen;
    const panel = document.getElementById('moderatorsPanel');
    const chevron = document.getElementById('moderatorsChevron');
    panel.classList.toggle('open', modsOpen);
    chevron.classList.toggle('rotated', modsOpen);
}

function loadModerators() {
    modsPage = 1;
    regularMembersPage = 1;
    renderModeratorsPanel();
}

function renderModeratorsPanel() {
    const container = document.getElementById('moderatorContainer');
    const mods = members.filter(m => m.role === 'moderator');
    const regularMembers = members.filter(m => m.role === 'member');

    container.innerHTML = `
        <div class="mod-tables-grid">
            <div class="mod-table-card card">
                <div class="mod-table-header">Moderators</div>
                ${renderModRows(mods, 'mod')}
            </div>
            <div class="mod-table-card card">
                <div class="mod-table-header">Members</div>
                ${renderModRows(regularMembers, 'member')}
            </div>
        </div>
    `;
}

function renderModRows(list, kind) {
    if (list.length === 0) {
        const label = kind === 'mod' ? 'No moderators yet.' : 'No members yet.';
        return `<p class="text-muted text-sm">${label}</p>`;
    }
    const page = kind === 'mod' ? modsPage : regularMembersPage;
    const totalPages = Math.ceil(list.length / MOD_TABLE_PER_PAGE);
    const start = (page - 1) * MOD_TABLE_PER_PAGE;
    const slice = list.slice(start, start + MOD_TABLE_PER_PAGE);

    const rows = slice.map(m => kind === 'mod'
        ? `<div class="mod-table-row">
              <span class="member-name">${m.username}</span>
              <button class="btn btn-outline btn-sm" onclick="demoteModerator('${m.user_id}','${m.username}')">Remove</button>
           </div>`
        : `<div class="mod-table-row">
              <span class="member-name">${m.username}</span>
              <button class="btn btn-outline btn-sm" onclick="promoteModerator('${m.user_id}','${m.username}')">Make Mod</button>
           </div>`
    ).join('');

    const fnName = kind === 'mod' ? 'changeModsPage' : 'changeRegularMembersPage';
    const label = kind === 'mod' ? 'mods' : 'members';
    const pagination = totalPages > 1 ? `
        <div class="health-pagination">
            <button class="health-page-btn" onclick="${fnName}(${page - 1})" ${page === 1 ? 'disabled' : ''}>←</button>
            <span class="health-page-info">${page}/${totalPages} <span class="health-page-count">(${list.length} ${label})</span></span>
            <button class="health-page-btn" onclick="${fnName}(${page + 1})" ${page === totalPages ? 'disabled' : ''}>→</button>
        </div>
    ` : '';

    return rows + pagination;
}

function changeModsPage(page) {
    const total = members.filter(m => m.role === 'moderator').length;
    const totalPages = Math.ceil(total / MOD_TABLE_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    modsPage = page;
    renderModeratorsPanel();
}

function changeRegularMembersPage(page) {
    const total = members.filter(m => m.role === 'member').length;
    const totalPages = Math.ceil(total / MOD_TABLE_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    regularMembersPage = page;
    renderModeratorsPanel();
}

async function promoteModerator(userId, username) {
    try {
        const res = await fetch(`/api/projects/${projectId}/moderators`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`${username} is now a moderator`, 'success');
            await fetchMembers();
            loadModerators();
        } else {
            showToast(data.message || 'Failed to promote', 'error');
        }
    } catch (e) {
        showToast('Failed to promote moderator', 'error');
    }
}

async function demoteModerator(userId, username) {
    try {
        const res = await fetch(`/api/projects/${projectId}/moderators/${userId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`${username} is no longer a moderator`, 'success');
            await fetchMembers();
            loadModerators();
        } else {
            showToast(data.message || 'Failed to demote', 'error');
        }
    } catch (e) {
        showToast('Failed to demote moderator', 'error');
    }
}

// Block 3: Quick Settings — recruitment status indicator
function updateRecruitStatus() {
    const el = document.getElementById('adminRecruitStatus');
    if (!el || !project) return;
    if (project.recruitmentOpen) {
        el.innerHTML = '<span class="text-success">Open</span>';
    } else {
        el.innerHTML = '<span class="text-danger">Closed</span>';
    }
}

// Block 3: Quick Settings — recruitment toggle
async function adminToggleRecruitment() {
    try {
        const res = await fetch(`/api/projects/${projectId}/recruitment`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok) {
            project.recruitmentOpen = data.recruitment_open;
            showToast(`Recruitment is now ${data.recruitment_open ? 'open' : 'closed'}`, 'success');
            updateRecruitStatus();
            renderProjectDetails();
        } else {
            showToast(data.message || 'Failed to toggle recruitment', 'error');
        }
    } catch (e) {
        showToast('Failed to toggle recruitment', 'error');
    }
}

// Block 4: Kick Voting — fetch once, render in both admin panel and overview
async function loadKickVotes() {
    try {
        const res = await fetch(`/api/projects/${projectId}/kick-votes`);
        const data = await res.json();

        const allVotes = data.votes || [];
        const openVotes = allVotes.filter(v => v.status === 'open');
        const pastVotes = allVotes.filter(v => v.status !== 'open');

        kickActiveAll = openVotes;
        kickPastAll = pastVotes;
        kickActivePage = 1;
        kickPastPage = 1;
        renderActiveKicks();
        renderPastKicks();

        // Overview tab: only open votes, visible to all members (paginated + collapsible)
        const activeSection = document.getElementById('activeVotesSection');
        if (activeSection) {
            if (openVotes.length > 0) {
                activeSection.style.display = 'block';
                overviewActiveKicksPage = 1;
                renderOverviewActiveKicks();
            } else {
                activeSection.style.display = 'none';
            }
        }

        // Red dot on Overview tab if there are open votes
    } catch (e) {
        const activeContainer = document.getElementById('activeKicksContainer');
        const pastContainer = document.getElementById('pastKicksContainer');
        if (activeContainer) activeContainer.innerHTML = '<p class="text-muted">Failed to load kick votes.</p>';
        if (pastContainer) pastContainer.innerHTML = '';
    }
}

// Active / Past kick votes — collapsible + paginated
const KICKS_PER_PAGE = 5;
let kickActiveAll = [];
let kickPastAll = [];
let kickActivePage = 1;
let kickPastPage = 1;
let activeKicksOpen = false;
let pastKicksOpen = false;

function toggleActiveKicks() {
    activeKicksOpen = !activeKicksOpen;
    document.getElementById('activeKicksPanel').classList.toggle('open', activeKicksOpen);
    document.getElementById('activeKicksChevron').classList.toggle('rotated', activeKicksOpen);
}

function togglePastKicks() {
    pastKicksOpen = !pastKicksOpen;
    document.getElementById('pastKicksPanel').classList.toggle('open', pastKicksOpen);
    document.getElementById('pastKicksChevron').classList.toggle('rotated', pastKicksOpen);
}

function renderActiveKicks() {
    renderKickList('active');
}

function renderPastKicks() {
    renderKickList('past');
}

function renderKickList(kind) {
    const list = kind === 'active' ? kickActiveAll : kickPastAll;
    const page = kind === 'active' ? kickActivePage : kickPastPage;
    const containerId = kind === 'active' ? 'activeKicksContainer' : 'pastKicksContainer';
    const container = document.getElementById(containerId);
    if (!container) return;

    if (list.length === 0) {
        const label = kind === 'active' ? 'No active kick votes.' : 'No past kick votes.';
        container.innerHTML = `<div class="card card-sm"><p class="text-muted">${label}</p></div>`;
        return;
    }

    const totalPages = Math.ceil(list.length / KICKS_PER_PAGE);
    const start = (page - 1) * KICKS_PER_PAGE;
    const slice = list.slice(start, start + KICKS_PER_PAGE);
    const cards = slice.map(v => renderKickVoteCard(v, true)).join('');

    const fnName = kind === 'active' ? 'changeActiveKicksPage' : 'changePastKicksPage';
    const labelTotal = kind === 'active' ? 'active' : 'past';
    const pagination = totalPages > 1 ? `
        <div class="health-pagination">
            <button class="health-page-btn" onclick="${fnName}(${page - 1})" ${page === 1 ? 'disabled' : ''}>←</button>
            <span class="health-page-info">${page}/${totalPages} <span class="health-page-count">(${list.length} ${labelTotal})</span></span>
            <button class="health-page-btn" onclick="${fnName}(${page + 1})" ${page === totalPages ? 'disabled' : ''}>→</button>
        </div>
    ` : '';

    container.innerHTML = cards + pagination;
}

function changeActiveKicksPage(page) {
    const totalPages = Math.ceil(kickActiveAll.length / KICKS_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    kickActivePage = page;
    renderActiveKicks();
}

function changePastKicksPage(page) {
    const totalPages = Math.ceil(kickPastAll.length / KICKS_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    kickPastPage = page;
    renderPastKicks();
}

// Overview-side active votes (read-only for non-admin, no Start button)
// Pinned at the top of Overview when present — no collapse
let overviewActiveKicksPage = 1;

function renderOverviewActiveKicks() {
    const container = document.getElementById('activeVotesContainer');
    if (!container) return;
    const list = kickActiveAll;
    if (list.length === 0) {
        container.innerHTML = '';
        return;
    }
    const totalPages = Math.ceil(list.length / KICKS_PER_PAGE);
    const start = (overviewActiveKicksPage - 1) * KICKS_PER_PAGE;
    const slice = list.slice(start, start + KICKS_PER_PAGE);
    const cards = slice.map(v => renderKickVoteCard(v, false)).join('');

    const pagination = totalPages > 1 ? `
        <div class="health-pagination">
            <button class="health-page-btn" onclick="changeOverviewActiveKicksPage(${overviewActiveKicksPage - 1})" ${overviewActiveKicksPage === 1 ? 'disabled' : ''}>←</button>
            <span class="health-page-info">${overviewActiveKicksPage}/${totalPages} <span class="health-page-count">(${list.length} active)</span></span>
            <button class="health-page-btn" onclick="changeOverviewActiveKicksPage(${overviewActiveKicksPage + 1})" ${overviewActiveKicksPage === totalPages ? 'disabled' : ''}>→</button>
        </div>
    ` : '';

    container.innerHTML = cards + pagination;
}

function changeOverviewActiveKicksPage(page) {
    const totalPages = Math.ceil(kickActiveAll.length / KICKS_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    overviewActiveKicksPage = page;
    renderOverviewActiveKicks();
}

function renderKickVoteCard(v, showCancel = false) {
    const isOpen = v.status === 'open';
    const expiresIn = isOpen ? formatTimeRemaining(v.expires_at) : '';
    const statusBadge = {
        open: '<span class="badge badge-success">Open</span>',
        passed: '<span class="badge badge-kicked">Passed — Kicked</span>',
        failed: '<span class="badge badge-deleted">Failed</span>',
        cancelled: '<span class="badge">Cancelled</span>'
    }[v.status] || '';

    // Check if current user joined after the vote started
    const currentMember = members.find(m => m.user_id === currentUserId);
    const joinedAfterVote = currentMember && new Date(currentMember.joined_at) > new Date(v.created_at);

    let voteActions = '';
    if (isOpen && v.target_user_id === currentUserId) {
        voteActions = '<p class="text-muted vote-info-note">You cannot vote on your own kick.</p>';
    } else if (isOpen && joinedAfterVote) {
        voteActions = '<p class="text-muted vote-info-note">You joined after this vote started and cannot participate.</p>';
    } else if (isOpen) {
        const voted = !!v.myBallot;
        voteActions = `
        <div class="vote-actions-row">
            <button class="btn btn-primary btn-sm ${v.myBallot === 'yes' ? 'btn-active' : ''}" onclick="castBallot('${v.id}','yes')" ${voted ? 'disabled' : ''}>
                Yes (${v.yes_count})
            </button>
            <button class="btn btn-outline btn-sm ${v.myBallot === 'no' ? 'btn-active' : ''}" onclick="castBallot('${v.id}','no')" ${voted ? 'disabled' : ''}>
                No (${v.no_count})
            </button>
            ${voted ? '<span class="text-muted vote-locked-label">Vote locked</span>' : ''}
            ${showCancel && currentUserRole === 'creator' ? `<button class="btn btn-outline btn-sm" onclick="cancelKickVote('${v.id}')">Cancel</button>` : ''}
        </div>`;
    }

    return `
        <div class="kick-vote-row">
            <div class="kick-vote-row-top">
                <div class="kick-vote-row-info">
                    <div class="kick-vote-row-title">
                        <span class="member-name">Kick: ${v.target_username}</span>
                        <span class="member-role-inline">by ${v.initiator_username}</span>
                    </div>
                    <div class="kick-vote-row-meta">
                        ${isOpen ? `<span>Expires ${expiresIn}</span>` : ''}
                        <span>Yes ${v.yes_count}</span>
                        <span>No ${v.no_count}</span>
                        <span>Voted ${v.total_voted ?? (v.yes_count + v.no_count)}</span>
                    </div>
                </div>
                ${statusBadge}
            </div>
            ${voteActions}
        </div>
    `;
}

function formatTimeRemaining(expiresAt) {
    const diff = new Date(expiresAt) - new Date();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
    return `in ${hours}h ${mins}m`;
}

async function castBallot(voteId, ballot) {
    try {
        const res = await fetch(`/api/projects/${projectId}/kick-votes/${voteId}/ballot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ballot })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Voted ${ballot}`, 'success');
            loadKickVotes();
            if (typeof fetchNotifRequests === 'function') fetchNotifRequests();
            if (data.voteStatus === 'passed') {
                showToast('Kick vote passed! Member has been removed.', 'info');
                await fetchMembers();
            }
        } else {
            showToast(data.message || 'Failed to cast ballot', 'error');
        }
    } catch (e) {
        showToast('Failed to cast ballot', 'error');
    }
}

async function cancelKickVote(voteId) {
    try {
        const res = await fetch(`/api/projects/${projectId}/kick-votes/${voteId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Kick vote cancelled', 'success');
            loadKickVotes();
            if (typeof fetchNotifRequests === 'function') fetchNotifRequests();
        } else {
            showToast(data.message || 'Failed to cancel', 'error');
        }
    } catch (e) {
        showToast('Failed to cancel vote', 'error');
    }
}

// ========================================
// PROJECT HEALTH
// ========================================

let healthOpen = false;

// Block 1: Pending requests pagination + collapsible state
const REQUESTS_PER_PAGE = 5;
let allRequests = [];
let requestsPage = 1;
let requestsOpen = false;

function toggleHealth() {
    healthOpen = !healthOpen;
    const panel = document.getElementById('healthPanel');
    const chevron = document.getElementById('healthChevron');
    panel.classList.toggle('open', healthOpen);
    chevron.classList.toggle('rotated', healthOpen);
}

function updateHealthDot(issues) {
    const dot = document.getElementById('healthStatusDot');
    dot.classList.remove('dot-ok', 'dot-warn', 'dot-error');
    if (!issues || issues.length === 0) {
        dot.classList.add('dot-ok');
    } else if (issues.some(i => i.type === 'not_collaborator' || i.type === 'vote_expired')) {
        dot.classList.add('dot-error');
    } else {
        dot.classList.add('dot-warn');
    }
}


const HEALTH_PER_PAGE = 5;
let healthIssues = [];
let healthPage = 1;
let healthReads = {}; // issueKey → { creator: bool, moderator: bool }

async function loadProjectHealth() {
    const container = document.getElementById('healthContainer');

    try {
        // Fetch issues and read state in parallel
        const [issuesRes, readsRes] = await Promise.all([
            fetch(`/api/projects/${projectId}/health`),
            fetch(`/api/projects/${projectId}/health-reads`)
        ]);
        const issuesData = await issuesRes.json();
        const readsData = await readsRes.json();

        if (!issuesData.success) {
            container.innerHTML = '<p class="text-muted">Could not load health data.</p>';
            return;
        }

        // Build healthReads map: issueKey → { creator: bool, moderator: bool }
        healthReads = {};
        if (readsData.success) {
            for (const r of readsData.reads) {
                if (!healthReads[r.issue_key]) healthReads[r.issue_key] = {};
                healthReads[r.issue_key][r.role] = true;
            }
        }

        healthIssues = issuesData.issues;
        updateHealthDot(healthIssues);
        healthPage = 1;
        renderHealthPage();
    } catch (e) {
        container.innerHTML = '<p class="text-muted">Could not load health data.</p>';
    }
}

function issueKey(issue, idx) {
    return `${issue.type}_${issue.userId || issue.voteId || idx}`;
}

// Resolve is one-way — creator marks, cannot unmark
async function resolveHealthIssue(issueKeyStr) {
    if (currentUserRole !== 'creator') return;
    if (healthReads[issueKeyStr] && healthReads[issueKeyStr].creator) return;

    if (!healthReads[issueKeyStr]) healthReads[issueKeyStr] = {};
    healthReads[issueKeyStr].creator = true;
    renderHealthPage();

    try {
        const res = await fetch(`/api/projects/${projectId}/health-reads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issueKey: issueKeyStr, role: 'creator', read: true })
        });
        if (!res.ok) throw new Error();
    } catch {
        healthReads[issueKeyStr].creator = false;
        renderHealthPage();
        showToast('Failed to resolve issue', 'error');
    }
}

// Mod acknowledge — still toggleable
async function toggleModRead(issueKeyStr) {
    if (currentUserRole !== 'moderator') return;

    const prev = !!(healthReads[issueKeyStr] && healthReads[issueKeyStr].moderator);
    if (!healthReads[issueKeyStr]) healthReads[issueKeyStr] = {};
    healthReads[issueKeyStr].moderator = !prev;
    renderHealthPage();

    try {
        const res = await fetch(`/api/projects/${projectId}/health-reads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issueKey: issueKeyStr, role: 'moderator', read: !prev })
        });
        if (!res.ok) throw new Error();
    } catch {
        healthReads[issueKeyStr].moderator = prev;
        renderHealthPage();
        showToast('Failed to save read state', 'error');
    }
}

// Creator dismisses issue entirely — removed from list
async function dismissHealthIssue(issueKeyStr) {
    if (currentUserRole !== 'creator') return;
    showConfirm('Dismiss this issue? It will be removed from the health panel.', async () => {
        const prevIssues = healthIssues;
        healthIssues = healthIssues.filter((issue, idx) => issueKey(issue, idx) !== issueKeyStr);
        renderHealthPage();
        updateHealthDot(healthIssues);

        try {
            const res = await fetch(`/api/projects/${projectId}/health-reads/${encodeURIComponent(issueKeyStr)}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error();
        } catch {
            healthIssues = prevIssues;
            renderHealthPage();
            showToast('Failed to dismiss issue', 'error');
        }
    }, { confirmText: 'Dismiss', danger: true });
}

function renderHealthPage() {
    const container = document.getElementById('healthContainer');
    if (!healthIssues || healthIssues.length === 0) {
        container.innerHTML = '<div class="health-panel-inner"><div class="health-ok">✓ No issues detected</div></div>';
        return;
    }
    const total = healthIssues.length;
    const totalPages = Math.ceil(total / HEALTH_PER_PAGE);
    const start = (healthPage - 1) * HEALTH_PER_PAGE;
    const pageItems = healthIssues.slice(start, start + HEALTH_PER_PAGE);

    const issuesHtml = pageItems.map((issue, i) => {
        const globalIdx = start + i;
        const key = issueKey(issue, globalIdx);
        const reads = healthReads[key] || {};
        return renderHealthIssue(issue, key, reads);
    }).join('');

    let paginationHtml = '';
    if (totalPages > 1) {
        paginationHtml = `
            <div class="health-pagination">
                <button class="btn btn-outline btn-sm" onclick="healthChangePage(${healthPage - 1})" ${healthPage === 1 ? 'disabled' : ''}>←</button>
                <span class="health-page-info">${healthPage} / ${totalPages} (${total} issues)</span>
                <button class="btn btn-outline btn-sm" onclick="healthChangePage(${healthPage + 1})" ${healthPage === totalPages ? 'disabled' : ''}>→</button>
            </div>`;
    }

    container.innerHTML = `<div class="health-panel-inner">${issuesHtml}${paginationHtml}</div>`;
}

function healthChangePage(page) {
    const totalPages = Math.ceil(healthIssues.length / HEALTH_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    healthPage = page;
    renderHealthPage();
}

function renderHealthIssue(issue, key, reads) {
    const configs = {
        invite_not_sent: {
            severity: 'warn',
            title: 'GitHub invite not sent',
            desc: `<strong>${issue.username}</strong> is an active member but hasn't received a GitHub collaborator invite.`
        },
        invite_stuck: {
            severity: 'warn',
            title: 'GitHub invite pending',
            desc: `<strong>${issue.username}</strong>'s invite has been pending for <strong>${issue.days} days</strong>. Auto-accept may have failed.`
        },
        vote_expired: {
            severity: 'error',
            title: 'Expired kick vote unresolved',
            desc: `A kick vote against <strong>${issue.targetUsername}</strong> expired without being resolved.`
        },
        not_collaborator: {
            severity: 'error',
            title: 'Removed from GitHub',
            desc: `<strong>${issue.username}</strong> is active on PtahNest but is no longer a collaborator on the GitHub repo.`
        }
    };
    const c = configs[issue.type];
    if (!c) return '';

    const isResolved = !!(reads && reads.creator);
    const modAcked = !!(reads && reads.moderator);
    const isCreator = currentUserRole === 'creator';
    const isMod = currentUserRole === 'moderator';

    // Build action buttons row
    let actionsHtml = '';
    if (isCreator) {
        actionsHtml += isResolved
            ? `<span class="health-resolved-badge">✓ Reviewed</span>`
            : `<button class="btn btn-sm btn-outline" onclick="resolveHealthIssue('${key}')">Mark Reviewed</button>`;
        actionsHtml += `<button class="btn btn-sm btn-outline btn-danger health-delete-btn" onclick="dismissHealthIssue('${key}')">✕</button>`;
    } else if (isMod) {
        if (isResolved) actionsHtml += `<span class="health-resolved-badge">✓ Resolved</span>`;
        actionsHtml += `<button class="btn btn-sm btn-outline${modAcked ? ' health-mod-acked' : ''}" onclick="toggleModRead('${key}')">${modAcked ? '✓ Acked' : 'Acknowledge'}</button>`;
    }

    const modAckedFooter = isCreator && modAcked ? `<div class="health-mod-badge">· Mod ✓</div>` : '';

    return `
        <div class="health-issue health-issue-${c.severity}${isResolved ? ' health-issue-read' : ''}">
            <div class="health-issue-body">
                <div class="health-issue-title">${c.title}</div>
                <div class="health-issue-desc">${c.desc}</div>
                ${modAckedFooter}
            </div>
            <div class="health-issue-actions">${actionsHtml}</div>
        </div>`;
}

// ========================================
// REQUEST DETAIL MODAL — Profile + Chat
// ========================================
let rdRequestId = null;
let rdApplicantUserId = null;
let rdPollingInterval = null;

async function openRequestDetail(requestId, username, userId) {
    rdRequestId = requestId;
    rdApplicantUserId = userId;
    document.getElementById('requestDetailModal').style.display = 'flex';
    document.getElementById('rdUsername').textContent = username;
    document.getElementById('rdAvatar').textContent = username.charAt(0).toUpperCase();
    document.getElementById('rdMessages').innerHTML = '<p class="chat-empty">Loading...</p>';
    document.getElementById('rdProjects').innerHTML = '';
    document.getElementById('rdGithub').innerHTML = '';
    document.getElementById('rdStars').innerHTML = '';
    document.getElementById('rdMeta').textContent = '';

    // Only management can accept/reject
    const isManagement = currentUserRole === 'creator' || currentUserRole === 'moderator';
    document.getElementById('rdAcceptBtn').style.display = isManagement ? '' : 'none';
    document.getElementById('rdRejectBtn').style.display = isManagement ? '' : 'none';

    // Parallel: fetch profile + messages
    fetchApplicantProfile(userId);
    fetchAndRenderMessages();

    // Poll messages every 5s while modal is open
    rdPollingInterval = setInterval(fetchAndRenderMessages, 2000);
}

function closeRequestDetail() {
    document.getElementById('requestDetailModal').style.display = 'none';
    clearInterval(rdPollingInterval);
    rdPollingInterval = null;
    rdRequestId = null;
    rdApplicantUserId = null;
    document.getElementById('rdMessageInput').value = '';
}

async function fetchApplicantProfile(userId) {
    try {
        const res = await fetch(`/api/projects/users/${userId}/profile`);
        const data = await res.json();
        if (!data.success) return;
        const p = data.profile;

        document.getElementById('rdMeta').textContent = `Member since ${formatDate(p.created_at)}`;

        if (p.github_username) {
            document.getElementById('rdGithub').innerHTML =
                `<a href="https://github.com/${p.github_username}" target="_blank" rel="noopener">
                    <img src="../pictures/icons/github.svg" width="13" height="13"> ${p.github_username}
                </a>`;
        }

        // Mock star rating (placeholder until real system)
        const starCount = Math.floor(Math.random() * 5) + 1;
        const stars = Array.from({ length: 5 }, (_, i) =>
            `<img src="../pictures/icons/${i < starCount ? 'star-filled' : 'star-outline'}.svg">`
        ).join('');
        document.getElementById('rdStars').innerHTML = stars + '<span class="stars-mock-label">(mock)</span>';

        // Project history
        if (p.projects && p.projects.length > 0) {
            const projectsHTML = p.projects.map(proj => {
                const repoInfo = proj.github_repo
                    ? (typeof proj.github_repo === 'object' && proj.github_repo.private
                        ? '<div class="profile-project-repo">🔒 Private repo</div>'
                        : `<div class="profile-project-repo">${proj.github_repo}</div>`)
                    : '';
                return `
                    <div class="profile-project-item">
                        <div class="profile-project-name">${proj.name}</div>
                        <div class="profile-project-role">${proj.role} · ${proj.membership_status}</div>
                        ${repoInfo}
                    </div>`;
            }).join('');
            document.getElementById('rdProjects').innerHTML =
                `<h4>Projects</h4>${projectsHTML}`;
        } else {
            document.getElementById('rdProjects').innerHTML =
                '<h4>Projects</h4><p class="text-muted text-xs">No projects yet.</p>';
        }
    } catch (e) {
        // silently fail — non-critical
    }
}

async function fetchAndRenderMessages() {
    if (!rdRequestId) return;
    try {
        const res = await fetch(`/api/projects/${projectId}/requests/${rdRequestId}/messages`);
        const data = await res.json();
        if (!data.success) return;
        const container = document.getElementById('rdMessages');
        if (data.messages.length === 0) {
            container.innerHTML = '<p class="chat-empty">No messages yet. Say hello!</p>';
            return;
        }
        const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 40;
        container.innerHTML = data.messages.map(m => {
            // Applicant messages always left, management messages always right
            const senderIsApplicant = m.sender_id === rdApplicantUserId;
            const onRight = !senderIsApplicant;
            const roleLabel = m.sender_role === 'creator' ? 'Creator'
                            : m.sender_role === 'moderator' ? 'Mod'
                            : '';
            const senderLine = roleLabel
                ? `${m.sender_username} <span class="chat-sender-role">${roleLabel}</span>`
                : m.sender_username;
            return `
                <div class="chat-message ${onRight ? 'chat-message-self' : 'chat-message-other'}">
                    <div class="chat-message-sender">${senderLine}</div>
                    <div>${m.content}</div>
                    <div class="chat-message-time">${formatDate(m.created_at)}</div>
                </div>`;
        }).join('');
        if (wasAtBottom) container.scrollTop = container.scrollHeight;
    } catch (e) {
        // silently fail
    }
}

async function sendRequestMessage() {
    const input = document.getElementById('rdMessageInput');
    const content = input.value.trim();
    if (!content || !rdRequestId) return;
    try {
        const res = await fetch(`/api/projects/${projectId}/requests/${rdRequestId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
            input.value = '';
            fetchAndRenderMessages();
            loadAdminRequests();
            if (typeof fetchNotifRequests === 'function') fetchNotifRequests();
        } else {
            showToast(data.message || 'Failed to send', 'error');
        }
    } catch (e) {
        showToast('Failed to send message', 'error');
    }
}

async function handleRequestFromModal(action) {
    if (!rdRequestId) return;
    const requestId = rdRequestId;
    const username = document.getElementById('rdUsername').textContent;
    closeRequestDetail();
    await handleRequest(requestId, action, username);
}

function openStartKickVoteModal() {
    const select = document.getElementById('kickTargetSelect');
    const kickableMembers = members.filter(m => m.role !== 'creator' && m.user_id !== currentUserId);
    select.innerHTML = '<option value="">Select member...</option>' +
        kickableMembers.map(m => `<option value="${m.user_id}">${m.username}${m.role === 'moderator' ? ' (Mod)' : ''}</option>`).join('');
    document.getElementById('kickVoteModal').style.display = 'flex';
}

function closeKickVoteModal() {
    document.getElementById('kickVoteModal').style.display = 'none';
}

async function submitKickVote() {
    const targetUserId = document.getElementById('kickTargetSelect').value;
    if (!targetUserId) {
        showToast('Please select a member', 'error');
        return;
    }
    try {
        const res = await fetch(`/api/projects/${projectId}/kick-votes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUserId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Kick vote started', 'success');
            closeKickVoteModal();
            loadKickVotes();
        } else {
            showToast(data.message || 'Failed to start kick vote', 'error');
        }
    } catch (e) {
        showToast('Failed to start kick vote', 'error');
    }
}

// Render action buttons (role-based)
function renderActions() {
    // Don't show actions for non-active projects
    if (project.status !== 'active') {
        const statusMessages = {
            'deleted': 'This project has been deleted',
            'completed': 'This project has been completed',
            'left': 'You have left this project',
            'kicked': 'You have been removed from this project'
        };
        document.getElementById('actionsSection').innerHTML = `
            <div class="card card-sm card-centered">
                <p class="text-muted">${statusMessages[project.status] || 'This project is no longer active'}</p>
            </div>
        `;
        return;
    }

    const isCreator = project.creator_id === currentUserId;
    const isMember = members.some(m => m.user_id === currentUserId && m.role !== 'creator');

    let actionsHTML = '<div class="action-row">';

    if (isCreator) {
        // Creator edit is in Admin Panel tab
    } else if (isMember) {
        // Member action: Leave
        actionsHTML += `
            <button class="btn btn-outline btn-danger" onclick="leaveProject()">Leave Project</button>
        `;
    }

    actionsHTML += '</div>';

    document.getElementById('actionsSection').innerHTML = actionsHTML;
}

// ========================================
// EDIT PROJECT MODAL
// ========================================
let editSelectedTags = new Set();

// Wire up tag buttons (runs once after DOM ready)
function initEditModal() {
    document.querySelectorAll('.edit-tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.getAttribute('data-tag');
            if (editSelectedTags.has(tag)) {
                editSelectedTags.delete(tag);
                btn.classList.remove('active');
            } else {
                editSelectedTags.add(tag);
                btn.classList.add('active');
            }
        });
    });

    // recruitment is read-only in this modal — toggled from Quick Settings

    document.getElementById('closeEditModal').addEventListener('click', closeEditModal);
    document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);
    document.getElementById('editModal').addEventListener('click', e => {
        if (e.target.id === 'editModal') closeEditModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('editModal').style.display === 'flex') closeEditModal();
    });

    document.getElementById('deleteConfirmInput').addEventListener('input', e => {
        const expected = document.getElementById('deleteProjectNameHint').textContent;
        document.getElementById('editDeleteBtn').disabled = e.target.value !== expected;
    });

    document.getElementById('editCompleteBtn').addEventListener('click', () => {
        const pid = document.getElementById('editProjectId').value;
        showConfirm('Mark this project as completed? Members will remain but recruitment will close.', async () => {
            try {
                const res = await fetch(`/api/projects/${pid}/complete`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (res.ok) {
                    showToast('Project marked as completed', 'success');
                    closeEditModal();
                    await fetchProjectDetails();
                } else {
                    showToast(data.message || 'Failed to complete project', 'error');
                }
            } catch (e) {
                showToast('Failed to complete project', 'error');
            }
        }, { confirmText: 'Complete Project' });
    });

    document.getElementById('editDeleteBtn').addEventListener('click', async () => {
        const pid = document.getElementById('editProjectId').value;
        try {
            const res = await fetch(`/api/projects/${pid}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Project deleted successfully', 'success');
                setTimeout(() => { window.location.href = '/pages/projects.html'; }, 1500);
            } else {
                showToast(data.message || 'Failed to delete project', 'error');
            }
        } catch (e) {
            showToast('Failed to delete project', 'error');
        }
    });

    document.getElementById('editProjectForm').addEventListener('submit', async e => {
        e.preventDefault();
        const pid = document.getElementById('editProjectId').value;
        const name = document.getElementById('editProjectName').value.trim();
        const description = document.getElementById('editProjectDescription').value.trim();
        const projectType = document.getElementById('editProjectType').value;
        const customTagsInput = document.getElementById('editCustomTags').value.trim();
        const customTags = customTagsInput ? customTagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
        const tags = [...Array.from(editSelectedTags), ...customTags];
        const lookingFor = Array.from(document.querySelectorAll('.edit-role-checkbox:checked')).map(cb => cb.value);
        const githubRepo = document.getElementById('editGithubRepo').value || null;
        const recruitmentOpen = document.getElementById('editRecruitmentOpen').value === 'true';

        try {
            const res = await fetch(`/api/projects/${pid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, tags, lookingFor, recruitmentOpen, githubRepo, projectType })
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.message || 'Failed to update project', 'error');
                return;
            }
            showToast('Project updated successfully', 'success');
            closeEditModal();
            await fetchProjectDetails();
        } catch (e) {
            showToast('Failed to update project', 'error');
        }
    });
}

function editProject() {
    if (!project) return;
    const presetTagNames = ['Frontend', 'Backend', 'Mobile', 'Design', 'AI/ML', 'DevOps'];
    const isSoftware = (project.projectType || 'software') === 'software';

    document.getElementById('editProjectId').value = project.id;
    document.getElementById('editProjectName').value = project.name;
    document.getElementById('editProjectDescription').value = project.description;
    document.getElementById('editProjectType').value = project.projectType || 'software';
    document.getElementById('editGithubRepo').value = project.githubRepo || '';
    document.getElementById('editLookingForGroup').style.display = isSoftware ? 'block' : 'none';
    document.getElementById('editPresetTagsGroup').style.display = isSoftware ? 'flex' : 'none';

    editSelectedTags.clear();
    const customTags = [];
    (project.tags || []).forEach(tag => {
        if (presetTagNames.includes(tag)) editSelectedTags.add(tag);
        else customTags.push(tag);
    });
    document.querySelectorAll('.edit-tag-btn').forEach(btn => {
        btn.classList.toggle('active', editSelectedTags.has(btn.dataset.tag));
    });
    document.getElementById('editCustomTags').value = customTags.join(', ');

    document.querySelectorAll('.edit-role-checkbox').forEach(cb => {
        cb.checked = (project.lookingFor || []).includes(cb.value);
    });

    const isOpen = project.recruitmentOpen !== false;
    document.getElementById('editRecruitmentOpen').value = isOpen ? 'true' : 'false';
    const recruitLabel = document.getElementById('editRecruitStatusLabel');
    if (recruitLabel) {
        recruitLabel.textContent = isOpen ? 'Open' : 'Closed';
        recruitLabel.classList.toggle('text-success', isOpen);
        recruitLabel.classList.toggle('text-danger', !isOpen);
    }

    // Complete + delete section only for creator
    const deleteSection = document.getElementById('editDeleteSection');
    deleteSection.style.display = currentUserRole === 'creator' ? 'block' : 'none';
    document.getElementById('editCompleteBtn').style.display = project.status === 'active' ? 'block' : 'none';
    document.getElementById('deleteProjectNameHint').textContent = project.name;
    document.getElementById('deleteConfirmInput').value = '';
    document.getElementById('editDeleteBtn').disabled = true;

    document.getElementById('editModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}


// Leave project
function leaveProject() {
    showConfirm('Are you sure you want to leave this project? It will appear in your Past projects.', async () => {
        try {
            const response = await fetch(`/api/projects/${projectId}/leave`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            const text = await response.text();
            let data;
            try { data = JSON.parse(text); } catch { data = { message: text || 'An error occurred' }; }
            if (response.ok) {
                showToast('You have left the project', 'success');
                setTimeout(() => { window.location.href = '/pages/projects.html'; }, 1500);
            } else {
                showToast(data.message || 'Failed to leave project', 'error');
            }
        } catch (error) {
            showToast('Failed to leave project. Please try again.', 'error');
        }
    }, { confirmText: 'Leave Project', danger: true });
}

// Helper functions
function getBadgeClass(status) {
    const badges = {
        'active': 'badge-success',
        'completed': 'badge-completed',
        'left': 'badge-left',
        'kicked': 'badge-kicked',
        'deleted': 'badge-deleted'
    };
    return badges[status] || 'badge-success';
}

function getBadgeText(status) {
    const texts = {
        'active': 'Active',
        'completed': 'Completed',
        'left': 'Left',
        'kicked': 'Kicked Out',
        'deleted': 'Deleted'
    };
    return texts[status] || 'Active';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
}

// ========================================
// CONTRIBUTION LEADERBOARD (mock)
// ========================================

let leaderboardPage = 1;
const LEADERBOARD_PER_PAGE = 5;

// Stable mock rating from sha — same formula as renderCommitRating
function mockRatingFromSha(sha) {
    return ((parseInt(String(sha).replace(/[^0-9]/g, '').slice(0, 4) || '0', 10) % 41) + 10) / 10;
}

// MOCK MODE — set to false to use real commit data
const LEADERBOARD_MOCK_MODE = true;

function computeLeaderboard() {
    if (LEADERBOARD_MOCK_MODE) {
        const fakes = [
            { author: 'alice',     commits: 12, avg: 4.6 },
            { author: 'bob',       commits: 9,  avg: 4.8 },
            { author: 'charlie',   commits: 11, avg: 3.9 },
            { author: 'diana',     commits: 7,  avg: 4.5 },
            { author: 'eve',       commits: 8,  avg: 3.8 },
            { author: 'frank',     commits: 5,  avg: 4.4 },
            { author: 'grace',     commits: 6,  avg: 3.6 },
            { author: 'henry',     commits: 4,  avg: 4.2 },
            { author: 'isabella',  commits: 5,  avg: 3.4 },
            { author: 'jack',      commits: 3,  avg: 4.5 },
            { author: 'kate',      commits: 4,  avg: 3.2 },
            { author: 'liam',      commits: 2,  avg: 4.8 },
            { author: 'mia',       commits: 3,  avg: 3.0 },
            { author: 'noah',      commits: 2,  avg: 3.5 },
            { author: 'olivia',    commits: 1,  avg: 5.0 }
        ];
        return fakes.map(f => ({
            author: f.author,
            avatar: null,
            commits: f.commits,
            totalRating: f.commits * f.avg,
            avgRating: f.avg,
            score: f.commits * f.avg
        })).sort((a, b) => b.score - a.score);
    }

    // Real: group commits by author
    const byAuthor = {};
    (allCommits || []).forEach(c => {
        const author = c.author || 'Unknown';
        if (!byAuthor[author]) {
            byAuthor[author] = { author, avatar: c.avatar || null, commits: 0, totalRating: 0 };
        }
        byAuthor[author].commits += 1;
        const r = c.rating != null ? c.rating : mockRatingFromSha(c.sha || '');
        byAuthor[author].totalRating += r;
    });

    return Object.values(byAuthor).map(a => ({
        ...a,
        avgRating: a.totalRating / a.commits,
        score: a.totalRating
    })).sort((a, b) => b.score - a.score);
}

function renderLeaderboard() {
    const container = document.getElementById('leaderboardContainer');
    if (!container) return;

    const entries = computeLeaderboard();
    if (entries.length === 0) {
        container.innerHTML = '<p class="text-muted section-empty-message">No data yet.</p>';
        return;
    }

    const top3 = entries.slice(0, 3);
    const rest = entries.slice(3);

    // DOM order: always 1-2-3 (so mobile single column shows 1st on top).
    // Desktop CSS uses `order` to display them as 2-1-3.
    const podiumOrder = [];
    if (top3[0]) podiumOrder.push({ entry: top3[0], place: 1 });
    if (top3[1]) podiumOrder.push({ entry: top3[1], place: 2 });
    if (top3[2]) podiumOrder.push({ entry: top3[2], place: 3 });

    const medal = (p) => p === 1 ? '🥇' : p === 2 ? '🥈' : '🥉';

    const podiumHTML = `
        <div class="leaderboard-podium">
            ${podiumOrder.map(({ entry, place }) => {
                const avatar = entry.avatar
                    ? `<img class="podium-avatar" src="${entry.avatar}" alt="${escapeHtml(entry.author)}">`
                    : `<div class="podium-avatar podium-avatar-placeholder">${escapeHtml(entry.author.charAt(0).toUpperCase())}</div>`;
                return `
                    <div class="podium-card podium-card-${place}">
                        <div class="podium-medal">${medal(place)}</div>
                        ${avatar}
                        <div class="podium-name">${escapeHtml(entry.author)}</div>
                        <div class="podium-score">${entry.score.toFixed(1)} <span class="podium-score-unit">pts</span></div>
                        <div class="podium-stats">
                            <span>${entry.commits} commit${entry.commits === 1 ? '' : 's'}</span>
                            <span>·</span>
                            <span>avg ${entry.avgRating.toFixed(1)}★</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    // Rest table with pagination
    let tableHTML = '';
    if (rest.length > 0) {
        const totalPages = Math.max(1, Math.ceil(rest.length / LEADERBOARD_PER_PAGE));
        if (leaderboardPage > totalPages) leaderboardPage = totalPages;
        const start = (leaderboardPage - 1) * LEADERBOARD_PER_PAGE;
        const pageRows = rest.slice(start, start + LEADERBOARD_PER_PAGE);

        const rows = pageRows.map((entry, i) => `
            <div class="leaderboard-row">
                <div class="leaderboard-rank">#${start + i + 4}</div>
                <div class="leaderboard-author">${escapeHtml(entry.author)}</div>
                <div class="leaderboard-stat leaderboard-score">${entry.score.toFixed(1)} pts</div>
                <div class="leaderboard-stat">${entry.commits} commit${entry.commits === 1 ? '' : 's'}</div>
                <div class="leaderboard-stat">avg ${entry.avgRating.toFixed(1)}★</div>
            </div>
        `).join('');

        const pagination = totalPages > 1 ? `
            <div class="health-pagination">
                <button class="health-page-btn" onclick="changeLeaderboardPage(${leaderboardPage - 1})" ${leaderboardPage === 1 ? 'disabled' : ''}>←</button>
                <span class="health-page-info">${leaderboardPage}/${totalPages} <span class="health-page-count">(${rest.length} more)</span></span>
                <button class="health-page-btn" onclick="changeLeaderboardPage(${leaderboardPage + 1})" ${leaderboardPage === totalPages ? 'disabled' : ''}>→</button>
            </div>
        ` : '';

        tableHTML = `<div class="leaderboard-table">${rows}</div>${pagination}`;
    }

    container.innerHTML = podiumHTML + tableHTML;
}

function changeLeaderboardPage(page) {
    leaderboardPage = page;
    renderLeaderboard();
}

// ========================================
// COMMIT HISTORY
// ========================================
let commitPage = 1;
let commitHasNext = false;
let commitLoading = false;
let allCommits = [];

// Fetch commits for current page
// MOCK MODE — set to false to use real GitHub commit data
const COMMITS_MOCK_MODE = true;

function getMockCommits() {
    const now = Date.now();
    const hAgo = (h) => new Date(now - h * 3600000).toISOString();
    const authors = ['alice', 'bob', 'charlie', 'diana', 'eve', 'frank', 'grace', 'henry'];

    const messages = [
        ['Add JWT-based authentication middleware', 'Replaces session cookies for API endpoints. Includes refresh token rotation and rate limiting on /auth/refresh.'],
        ['Fix race condition in kick vote resolver', 'Lazy resolve was firing twice when two members voted simultaneously.'],
        ['Refactor project-detail.js into modules', 'Split chat, todos, members, and admin panel into separate files.'],
        ['Add email verification flow', null],
        ['Optimize commit history pagination', 'Use server-side cursor instead of offset to avoid full-table scans.'],
        ['Update README with deployment instructions', null],
        ['Fix dark mode contrast on Discover page', 'Tag chips and meta text were unreadable on dark surfaces.'],
        ['Add notification bell badge animations', null],
        ['Migrate sessions table to PostgreSQL store', 'Removes in-memory session loss on container restart.'],
        ['Implement project-level chat with encryption', 'AES-256-GCM with per-project key derivation.'],
        ['Add unit tests for auth middleware', 'Cover session validation, fingerprint check, and rate limiting.'],
        ['Bump express to 4.21 and patch CVE-2024-XXXX', null],
        ['Add Sentry error monitoring', 'Configured with release tagging from CI.'],
        ['Improve mobile responsiveness for project cards', null],
        ['Fix typo in onboarding modal', null],
        ['Add Docker healthcheck endpoint', 'Returns 200 if DB is reachable, 503 otherwise.'],
        ['Refactor join request notifications', 'Batch sends instead of one per recipient.'],
        ['Add admin panel health metrics', 'Tracks pending requests, active kick votes, and stale members.'],
        ['Update privacy policy and terms', null],
        ['Implement contribution leaderboard UI', 'Mock data for now until commit voting backend is ready.'],
        ['Add CSRF protection middleware', null],
        ['Fix infinite loop in member pagination', 'Off-by-one in page total calculation.'],
        ['Migrate from npm to pnpm', null],
        ['Add database backup cron job', 'Daily at 03:00 UTC, retains 7 days of snapshots.'],
        ['Improve error messages on signup form', null]
    ];

    return messages.slice(0, 25).map((m, i) => {
        const author = authors[i % authors.length];
        return {
            sha: `mock${String(i).padStart(2, '0')}${Math.floor(Math.random() * 100000).toString(36)}`,
            author,
            avatar: null,
            message: m[1] ? `${m[0]}\n\n${m[1]}` : m[0],
            date: hAgo(i * 6 + Math.floor(Math.random() * 4)),
            url: '#'
        };
    });
}

async function fetchCommits(page = 1) {
    const section = document.getElementById('commitsSection');
    const container = document.getElementById('commitsContainer');
    const pagination = document.getElementById('commitsPagination');

    if (COMMITS_MOCK_MODE) {
        section.style.display = 'block';
        const mocks = getMockCommits();
        const PER_PAGE = 5;
        const start = (page - 1) * PER_PAGE;
        allCommits = mocks.slice(start, start + PER_PAGE);
        commitPage = page;
        commitHasNext = start + PER_PAGE < mocks.length;
        commitLoading = false;
        renderCommits();
        renderLeaderboard();
        return;
    }

    if (!project || !project.githubRepo) return;

    section.style.display = 'block';

    // First load: show placeholder; subsequent pages: dim existing content
    if (page === 1 && allCommits.length === 0) {
        container.innerHTML = '<div class="commits-loading">Loading commits...</div>';
    } else {
        container.style.opacity = '0.4';
        container.style.pointerEvents = 'none';
        pagination.style.opacity = '0.4';
        pagination.style.pointerEvents = 'none';
    }

    commitLoading = true;

    try {
        const response = await fetch(`/api/github/commits/${projectId}?page=${page}`);
        const data = await response.json();

        container.style.opacity = '';
        container.style.pointerEvents = '';
        pagination.style.opacity = '';
        pagination.style.pointerEvents = '';

        if (!data.success) {
            // GitHub not linked — show connect prompt instead of generic error
            if (data.githubRequired) {
                container.innerHTML = `<div class="commits-empty">Link your GitHub account to view commit history. <a href="/pages/profile.html">Go to Profile</a></div>`;
            } else {
                container.innerHTML = '<div class="commits-empty">Failed to load commits.</div>';
            }
            commitLoading = false;
            return;
        }

        // Replace, don't accumulate — each page is independent
        allCommits = data.commits;

        commitPage = data.page;
        commitHasNext = data.hasNextPage;
        commitLoading = false;

        renderCommits();
        renderLeaderboard(); // refresh leaderboard with real commit data
    } catch (error) {
        container.style.opacity = '';
        container.style.pointerEvents = '';
        pagination.style.opacity = '';
        pagination.style.pointerEvents = '';
        console.error('Fetch commits error:', error);
        container.innerHTML = '<div class="commits-empty">Failed to load commits.</div>';
        commitLoading = false;
    }
}

// Render commits with timeline style
function renderCommits() {
    const container = document.getElementById('commitsContainer');
    const pagination = document.getElementById('commitsPagination');

    if (allCommits.length === 0) {
        container.innerHTML = '<div class="commits-empty">No commits yet.</div>';
        pagination.innerHTML = '';
        return;
    }

    // Group commits by date
    const grouped = {};
    allCommits.forEach(commit => {
        const dateKey = new Date(commit.date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(commit);
    });

    let html = '';
    for (const [date, commits] of Object.entries(grouped)) {
        html += `<div class="input-label commit-date-label">${date}</div>`;
        html += '<div class="commit-list">';
        commits.forEach(commit => {
            // Split message into title + body
            const lines = commit.message.split('\n');
            const title = lines[0];
            const body = lines.slice(1).filter(l => l.trim()).join('\n');

            const avatarHTML = commit.avatar
                ? `<img class="commit-avatar" src="${commit.avatar}" alt="${commit.author}">`
                : `<div class="commit-avatar-placeholder">${commit.author.charAt(0).toUpperCase()}</div>`;

            // Mock effort rating (1.0 — 5.0). Stable per sha so it doesn't jitter on re-render.
            const rating = commit.rating != null
                ? commit.rating
                : (((parseInt(commit.sha.replace(/[^0-9]/g, '').slice(0, 4) || '0', 10) % 41) + 10) / 10);
            html += `
                <div class="commit-item">
                    ${avatarHTML}
                    <div class="commit-body">
                        <div class="commit-message">
                            <span class="commit-message-title">${escapeText(title)}</span>
                            ${body ? `<div class="commit-message-body">${escapeText(body)}</div>` : ''}
                        </div>
                        <div class="commit-meta">
                            <span class="commit-author">${escapeText(commit.author)}</span>
                            <span>${formatCommitDate(commit.date)}</span>
                        </div>
                    </div>
                    <div class="commit-actions">
                        ${renderCommitRating(rating)}
                        <a class="commit-review-btn" href="${commit.url}" target="_blank" rel="noopener" title="Review this commit on GitHub">
                            <img src="../pictures/icons/github.svg" width="12" height="12" alt="">
                            <span>Review</span>
                            <span class="commit-review-sha">${commit.sha.substring(0, 7)}</span>
                        </a>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    container.innerHTML = html;

    // Render pagination — match the rest of the app's collapsible-pagination style
    let paginationHTML = '';
    if (commitPage > 1 || commitHasNext) {
        paginationHTML = `
            <div class="health-pagination">
                <button class="health-page-btn" onclick="loadCommitPage(${commitPage - 1})" ${commitPage <= 1 ? 'disabled' : ''}>←</button>
                <span class="health-page-info">Page ${commitPage}</span>
                <button class="health-page-btn" onclick="loadCommitPage(${commitPage + 1})" ${!commitHasNext ? 'disabled' : ''}>→</button>
            </div>
        `;
    }
    pagination.innerHTML = paginationHTML;
}

// Render 5-star effort rating (mock voting result for now)
function renderCommitRating(value) {
    const v = Math.max(0, Math.min(5, Number(value) || 0));
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        if (v >= i) {
            stars += '<span class="commit-rating-star filled">★</span>';
        } else if (v >= i - 0.5) {
            stars += '<span class="commit-rating-star half">★</span>';
        } else {
            stars += '<span class="commit-rating-star">★</span>';
        }
    }
    return `
        <div class="commit-rating" title="Effort rating: ${v.toFixed(1)} / 5">
            <span class="commit-rating-stars">${stars}</span>
            <span class="commit-rating-value">${v.toFixed(1)}</span>
        </div>
    `;
}

// Load specific commit page (replaces current view)
function loadCommitPage(page) {
    fetchCommits(page);
    // Scroll to commits section
    document.getElementById('commitsSection').scrollIntoView({ behavior: 'smooth' });
}

// Escape text for safe HTML display (commits come from GitHub, not our backend)
function escapeText(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Format commit date with time
function formatCommitDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    if (hours < 48) return 'yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ========================================
// PROJECT TODOS
// ========================================

async function fetchTodos() {
    try {
        const res = await fetch(`/api/projects/${projectId}/todos`);
        const data = await res.json();
        if (!data.success) return;
        todos = data.todos;
        renderTodos();
    } catch (err) {
        console.error('Fetch todos error:', err);
    }
}

function populateTodoAssignSelect() {
    const sel = document.getElementById('todoAssignSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Unassigned</option>';
    members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.user_id;
        opt.textContent = m.username + (m.role !== 'member' ? ` (${m.role})` : '');
        sel.appendChild(opt);
    });
}

function setTodoFilter(filter) {
    todoFilter = filter;
    todoPage = 1;
    document.querySelectorAll('.todo-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    renderTodos();
}

function changeTodoPage(page) {
    todoPage = page;
    renderTodos();
}

function getFilteredTodos() {
    if (todoFilter === 'open') return todos.filter(t => !t.completed);
    if (todoFilter === 'done') return todos.filter(t => t.completed);
    return todos;
}

function updateTodoStats() {
    const total = todos.length;
    const done = todos.filter(t => t.completed).length;
    const open = total - done;
    const totalEl = document.getElementById('todoCountTotal');
    const openEl = document.getElementById('todoCountOpen');
    const doneEl = document.getElementById('todoCountDone');
    if (totalEl) totalEl.textContent = total;
    if (openEl) openEl.textContent = open;
    if (doneEl) doneEl.textContent = done;
}

function toggleTodoExpand() {
    todoExpanded = !todoExpanded;
    const filterEl = document.getElementById('teamTodoFilter');
    const btn = document.getElementById('todoExpandBtn');
    if (filterEl) filterEl.style.display = todoExpanded ? '' : 'none';
    if (btn) btn.textContent = todoExpanded ? 'Show less' : 'Show all';
    // Reset filter/page on collapse
    if (!todoExpanded) {
        todoFilter = 'all';
        todoPage = 1;
        document.querySelectorAll('.todo-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    }
    renderTodos();
}

function renderTodos() {
    const container = document.getElementById('todoList');
    const paginationEl = document.getElementById('todoPagination');
    if (!container) return;

    updateTodoStats();

    const isManagement = currentUserRole === 'creator' || currentUserRole === 'moderator';

    // Collapsed mode: show first N open todos as preview, no pagination/filter
    let displayTodos;
    let totalPages = 1;
    let filteredCount = 0;
    if (todoExpanded) {
        const filtered = getFilteredTodos();
        filteredCount = filtered.length;
        if (filtered.length === 0) {
            const msg = todos.length === 0 ? 'No todos yet. Click "+ New" to add one.' : `No ${todoFilter} todos.`;
            container.innerHTML = `<div class="todo-empty">${msg}</div>`;
            if (paginationEl) paginationEl.innerHTML = '';
            return;
        }
        totalPages = Math.max(1, Math.ceil(filtered.length / TODOS_PER_PAGE));
        if (todoPage > totalPages) todoPage = totalPages;
        const start = (todoPage - 1) * TODOS_PER_PAGE;
        displayTodos = filtered.slice(start, start + TODOS_PER_PAGE);
    } else {
        // Preview: open todos first, then done — show only top N
        const openTodos = todos.filter(t => !t.completed);
        const doneTodos = todos.filter(t => t.completed);
        const ordered = [...openTodos, ...doneTodos];
        if (ordered.length === 0) {
            container.innerHTML = '<div class="todo-empty">No todos yet. Click "+ New" to add one.</div>';
            if (paginationEl) paginationEl.innerHTML = '';
            return;
        }
        displayTodos = ordered.slice(0, TODO_PREVIEW_COUNT);
    }

    const pageTodos = displayTodos;
    const start = todoExpanded ? (todoPage - 1) * TODOS_PER_PAGE : 0;

    container.innerHTML = pageTodos.map(t => {
        const dueDateStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const isOverdue = t.due_date && !t.completed && new Date(t.due_date) < new Date();
        const isAuthor = t.created_by === currentUserId;
        const isAssignee = t.assigned_to === currentUserId;
        const canModify = isManagement || isAuthor; // edit/delete
        const canToggle = isManagement || isAuthor || isAssignee; // toggle complete
        const titleAttr = t.description ? ` title="${escapeHtml(t.description)}"` : '';
        const toggleDisabled = !canToggle;
        const checkboxTitle = toggleDisabled ? 'Only creator/moderator, todo author, or assignee can toggle' : 'Toggle complete';
        return `
          <div class="todo-item ${t.completed ? 'todo-item-done' : ''}">
            <button class="todo-checkbox ${t.completed ? 'todo-checkbox-checked' : ''} ${toggleDisabled ? 'todo-checkbox-disabled' : ''}"
                    ${toggleDisabled ? 'disabled' : `onclick="toggleTodo('${t.id}')"`}
                    title="${checkboxTitle}">
                ${t.completed ? '✓' : ''}
            </button>
            <div class="todo-item-body">
              <span class="todo-item-title"${titleAttr}>${escapeHtml(t.title)}</span>
              <div class="todo-item-meta">
                ${t.assigned_to_username ? `<span class="todo-meta-chip">@${escapeHtml(t.assigned_to_username)}</span>` : ''}
                ${dueDateStr ? `<span class="todo-meta-chip ${isOverdue ? 'todo-meta-overdue' : ''}">${dueDateStr}</span>` : ''}
              </div>
            </div>
            ${canModify ? `
              <div class="todo-item-actions">
                <button class="todo-action-btn" onclick="openEditTodoModal('${t.id}')" title="Edit">✎</button>
                <button class="todo-action-btn todo-action-delete" onclick="deleteTodo('${t.id}')" title="Delete">✕</button>
              </div>
            ` : ''}
          </div>`;
    }).join('');

    if (paginationEl) {
        if (todoExpanded && totalPages > 1) {
            paginationEl.innerHTML = `
                <div class="health-pagination">
                    <button class="health-page-btn" onclick="changeTodoPage(${todoPage - 1})" ${todoPage === 1 ? 'disabled' : ''}>←</button>
                    <span class="health-page-info">${todoPage}/${totalPages} <span class="health-page-count">(${filteredCount} todo${filteredCount === 1 ? '' : 's'})</span></span>
                    <button class="health-page-btn" onclick="changeTodoPage(${todoPage + 1})" ${todoPage === totalPages ? 'disabled' : ''}>→</button>
                </div>
            `;
        } else if (!todoExpanded && todos.length > TODO_PREVIEW_COUNT) {
            const more = todos.length - TODO_PREVIEW_COUNT;
            paginationEl.innerHTML = `<button class="todo-show-more" onclick="toggleTodoExpand()">+${more} more</button>`;
        } else {
            paginationEl.innerHTML = '';
        }
    }
}

function configureAssignField() {
    // Show/hide Assign To based on management role
    const isManagement = currentUserRole === 'creator' || currentUserRole === 'moderator';
    const select = document.getElementById('todoAssignSelect');
    const hint = document.getElementById('todoAssignHint');
    if (isManagement) {
        select.disabled = false;
        if (hint) hint.style.display = 'none';
    } else {
        select.disabled = true;
        select.value = '';
        if (hint) hint.style.display = 'block';
    }
}

function openTodoModal() {
    populateTodoAssignSelect();
    configureAssignField();
    document.getElementById('todoEditId').value = '';
    document.getElementById('todoModalTitle').textContent = 'New Todo';
    document.getElementById('todoSubmitBtn').textContent = 'Create Todo';
    document.getElementById('todoTitleInput').value = '';
    document.getElementById('todoDescInput').value = '';
    document.getElementById('todoDueInput').value = '';
    document.getElementById('todoAssignSelect').value = '';
    document.getElementById('todoModal').style.display = 'flex';
    setTimeout(() => document.getElementById('todoTitleInput').focus(), 50);
}

function openEditTodoModal(todoId) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;

    populateTodoAssignSelect();
    configureAssignField();
    document.getElementById('todoEditId').value = todo.id;
    document.getElementById('todoModalTitle').textContent = 'Edit Todo';
    document.getElementById('todoSubmitBtn').textContent = 'Save Changes';
    document.getElementById('todoTitleInput').value = todo.title;
    document.getElementById('todoDescInput').value = todo.description || '';
    document.getElementById('todoDueInput').value = todo.due_date ? todo.due_date.split('T')[0] : '';
    document.getElementById('todoAssignSelect').value = todo.assigned_to || '';
    document.getElementById('todoModal').style.display = 'flex';
    setTimeout(() => document.getElementById('todoTitleInput').focus(), 50);
}

function closeTodoModal() {
    document.getElementById('todoModal').style.display = 'none';
}

async function submitTodo() {
    const editId = document.getElementById('todoEditId').value;
    const title = document.getElementById('todoTitleInput').value.trim();
    if (!title) { showToast('Title is required', 'error'); return; }

    const body = {
        title,
        description: document.getElementById('todoDescInput').value.trim() || null,
        dueDate: document.getElementById('todoDueInput').value || null,
        assignedTo: document.getElementById('todoAssignSelect').value || null
    };

    const url = editId
        ? `/api/projects/${projectId}/todos/${editId}`
        : `/api/projects/${projectId}/todos`;
    const method = editId ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Failed to save todo', 'error'); return; }

        closeTodoModal();
        showToast(editId ? 'Todo updated' : 'Todo added', 'success');
        fetchTodos();
    } catch (err) {
        console.error('Submit todo error:', err);
        showToast('Failed to save todo', 'error');
    }
}

async function toggleTodo(todoId) {
    try {
        await fetch(`/api/projects/${projectId}/todos/${todoId}`, { method: 'PATCH' });
        fetchTodos();
    } catch (err) {
        console.error('Toggle todo error:', err);
    }
}

async function deleteTodo(todoId) {
    try {
        const res = await fetch(`/api/projects/${projectId}/todos/${todoId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Failed to delete', 'error'); return; }
        showToast('Todo deleted', 'success');
        fetchTodos();
    } catch (err) {
        console.error('Delete todo error:', err);
    }
}

// ========================================
// PROJECT CHAT
// ========================================

async function fetchProjectMessages() {
    try {
        const res = await fetch(`/api/projects/${projectId}/messages`);
        const data = await res.json();
        if (!data.success) return;
        renderProjectMessages(data.messages);
    } catch (err) {
        console.error('Fetch project messages error:', err);
    }
}

function renderProjectMessages(messages) {
    const container = document.getElementById('projectChatMessages');
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 40;

    if (messages.length === 0) {
        container.innerHTML = '<p class="text-muted section-empty-message-lg">No messages yet. Say hello!</p>';
        return;
    }

    container.innerHTML = messages.map(m => {
        const isSelf = m.sender_id === currentUserId;
        let roleLabel = '';
        if (m.sender_role === 'creator') roleLabel = ' <span class="chat-sender-role">Creator</span>';
        else if (m.sender_role === 'moderator') roleLabel = ' <span class="chat-sender-role">Mod</span>';
        return `
          <div class="chat-message ${isSelf ? 'chat-message-self' : 'chat-message-other'}">
            <div class="chat-message-sender">${escapeHtml(m.sender_username)}${roleLabel}</div>
            <div>${escapeHtml(m.content)}</div>
            <div class="chat-message-time">${formatDate(m.created_at)}</div>
          </div>`;
    }).join('');

    if (atBottom) container.scrollTop = container.scrollHeight;
}

async function sendProjectMessage() {
    const input = document.getElementById('projectChatInput');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    try {
        await fetch(`/api/projects/${projectId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        fetchProjectMessages();
    } catch (err) {
        console.error('Send project message error:', err);
    }
}

// Initialize on page load, then reveal content
(async function initProjectDetail() {
    initEditModal();
    await fetchProjectDetails();
    showMainContent();
})();
