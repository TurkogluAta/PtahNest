// Project type definitions — add new types here only
const PROJECT_TYPES = {
  software: { label: 'Software', badgeClass: 'badge-type-software' },
  research: { label: 'Research', badgeClass: 'badge-type-research' },
};

// State
let projects = [];
let allJoinRequests = [];
let githubLinked = false;

// Pagination state
const PROJECTS_PER_PAGE = 4;
let currentPage = 1;
let currentTab = 'active'; // 'active' or 'past'

// Fetch projects on page load
async function fetchProjects() {
    try {
        const response = await fetch('/api/projects', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch projects');
        }

        const data = await response.json();
        projects = data.projects;
        renderProjects();

        // Fetch join requests after projects are loaded
        await fetchJoinRequests();

    } catch (error) {
        console.error('Fetch projects error:', error);
        document.getElementById('activeProjectsContainer').innerHTML = `
            <div class="card">
                <p class="text-muted">Failed to load projects. Please refresh the page.</p>
            </div>
        `;
    }
}

// Get badge class based on status
function getBadgeClass(status) {
    const badges = {
        'active': 'badge-success',
        'completed': 'badge-completed',
        'left': 'badge-left',
        'kicked': 'badge-kicked'
    };
    return badges[status] || 'badge-success';
}

// Get badge text based on status
function getBadgeText(status) {
    const texts = {
        'active': 'Active',
        'completed': 'Completed',
        'left': 'Left',
        'kicked': 'Kicked Out'
    };
    return texts[status] || 'Active';
}

// Render a single project card
function renderProjectCard(project) {
    const tagsHTML = project.tags && project.tags.length > 0
        ? `<div class="project-tags">${project.tags.map(tag => `<span class="project-tag">${tag}</span>`).join('')}</div>`
        : '';

    const lookingForHTML = project.lookingFor && project.lookingFor.length > 0
        ? `<div class="project-looking-for">
             <span class="looking-for-label">Looking for:</span>
             ${project.lookingFor.map(role => `<span class="role-tag">${role}</span>`).join('')}
           </div>`
        : '';

    return `
        <div class="card card-hover card-bottom-gap card-clickable" onclick="window.location.href='/pages/project-detail.html?id=${project.id}'">
            <div class="project-card-header">
                <div>
                    <div class="card-title">${project.name}</div>
                    <div class="card-desc no-margin">${project.description}</div>
                </div>
                <div class="badge-group">
                    ${(() => { const t = PROJECT_TYPES[project.projectType] || PROJECT_TYPES.software; return `<span class="badge ${t.badgeClass}">${t.label}</span>`; })()}
                    <span class="badge ${getBadgeClass(project.status)}">${getBadgeText(project.status)}</span>
                </div>
            </div>
            ${tagsHTML}
            ${lookingForHTML}
            <div class="project-meta">
                <span class="meta-inline">
                    <img src="../pictures/icons/members.svg" width="16">
                    ${project.members} Members
                </span>
            </div>
        </div>
    `;
}

// Render pagination buttons
function renderPagination(totalProjects) {
    const totalPages = Math.ceil(totalProjects / PROJECTS_PER_PAGE);
    const paginationContainer = document.getElementById('projectPagination');

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    let buttonsHTML = '';

    // Previous button
    if (currentPage > 1) {
        buttonsHTML += `<button class="pagination-btn" onclick="changePage(${currentPage - 1})">Previous</button>`;
    }

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        buttonsHTML += `<button class="pagination-btn ${activeClass}" onclick="changePage(${i})">${i}</button>`;
    }

    // Next button
    if (currentPage < totalPages) {
        buttonsHTML += `<button class="pagination-btn" onclick="changePage(${currentPage + 1})">Next</button>`;
    }

    paginationContainer.innerHTML = buttonsHTML;
}

// Change page
function changePage(page) {
    currentPage = page;
    renderProjects();
}

// Switch tabs
function switchTab(tab) {
    currentTab = tab;
    currentPage = 1; // Reset to first page when switching tabs

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(tab + 'Tab').classList.add('active');

    // Update tab content visibility
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tab + 'Content').classList.add('active');

    // Re-render projects
    renderProjects();
}

// Render all projects with pagination (tab-based)
function renderProjects() {
    const activeContainer = document.getElementById('activeProjectsContainer');
    const pastContainer = document.getElementById('pastProjectsContainer');

    // Filter projects based on current tab
    let filteredProjects;
    let container;
    let emptyMessage;

    if (currentTab === 'active') {
        filteredProjects = projects.filter(p => p.status === 'active');
        container = activeContainer;
        emptyMessage = 'No active projects yet. Create one to get started!';
    } else {
        filteredProjects = projects.filter(p =>
            p.status === 'completed' || p.status === 'left' || p.status === 'kicked'
        );
        container = pastContainer;
        emptyMessage = 'No past projects.';
    }

    // Paginate
    const start = (currentPage - 1) * PROJECTS_PER_PAGE;
    const end = start + PROJECTS_PER_PAGE;
    const paginatedProjects = filteredProjects.slice(start, end);

    // Render
    if (paginatedProjects.length > 0) {
        container.innerHTML = paginatedProjects.map(renderProjectCard).join('');
        renderPagination(filteredProjects.length);
    } else {
        container.innerHTML = `
            <div class="card">
                <p class="text-muted">${emptyMessage}</p>
            </div>
        `;
        document.getElementById('projectPagination').innerHTML = '';
    }
}

// Toggle new project form
const newProjectBtn = document.getElementById('newProjectBtn');
const newProjectForm = document.getElementById('newProjectForm');
const cancelBtn = document.getElementById('cancelBtn');

// Tag selection handling
let selectedTagsSet = new Set();
const tagButtons = document.querySelectorAll('.tag-btn');

tagButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tag');
        if (selectedTagsSet.has(tag)) {
            selectedTagsSet.delete(tag);
            btn.classList.remove('active');
        } else {
            selectedTagsSet.add(tag);
            btn.classList.add('active');
        }
        document.getElementById('selectedTags').value = Array.from(selectedTagsSet).join(',');
    });
});

newProjectBtn.addEventListener('click', () => {
    newProjectForm.style.display =
        newProjectForm.style.display === 'none' ? 'block' : 'none';
});

cancelBtn.addEventListener('click', () => {
    newProjectForm.style.display = 'none';
    document.getElementById('createProjectForm').reset();
    // Reset tag buttons
    selectedTagsSet.clear();
    tagButtons.forEach(btn => btn.classList.remove('active'));
    document.getElementById('selectedTags').value = '';
    // Reset project type to default by triggering software button click
    document.querySelector('.type-btn[data-type="software"]').click();
});

// Project type toggle
document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('projectType').value = btn.dataset.type;

        // Show/hide GitHub repo section based on type
        const repoGroup = document.getElementById('githubRepoGroup');
        const hint = document.getElementById('projectTypeHint');
        const lookingForGroup = document.getElementById('lookingForGroup');
        const presetTagsGroup = document.getElementById('presetTagsGroup');
        if (btn.dataset.type === 'software') {
            repoGroup.style.display = 'block';
            lookingForGroup.style.display = 'block';
            presetTagsGroup.style.display = 'flex';
            if (!githubLinked) {
                hint.textContent = 'Software projects require a linked GitHub account.';
                hint.style.display = 'block';
                hint.style.color = 'var(--danger, #f85149)';
            }
        } else {
            repoGroup.style.display = 'none';
            document.getElementById('githubRepo').value = '';
            document.getElementById('repoSelectedText').textContent = 'No repository';
            hint.style.display = 'none';
            // Hide roles and preset tags for research projects
            lookingForGroup.style.display = 'none';
            presetTagsGroup.style.display = 'none';
            document.querySelectorAll('input[type="checkbox"].checkbox').forEach(cb => cb.checked = false);
            selectedTagsSet.clear();
            tagButtons.forEach(b => b.classList.remove('active'));
        }
    });
});

// Handle form submission
document.getElementById('createProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('projectName').value.trim();
    const description = document.getElementById('projectDescription').value.trim();

    // Get tags (both preset and custom)
    const customTagsInput = document.getElementById('customTags').value.trim();
    const customTags = customTagsInput ? customTagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
    const tags = [...Array.from(selectedTagsSet), ...customTags];

    // Get selected roles
    const roleCheckboxes = document.querySelectorAll('input[type="checkbox"].checkbox:checked');
    const lookingFor = Array.from(roleCheckboxes).map(cb => cb.value);

    // Get selected GitHub repo (empty string = null)
    const githubRepo = document.getElementById('githubRepo').value || null;
    const projectType = document.getElementById('projectType').value;

    try {
        const response = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, tags, lookingFor, githubRepo, projectType })
        });

        // GitHub not linked — redirect to profile
        if (!response.ok) {
            const data = await response.json();
            if (data.githubRequired) {
                if (confirm(data.message + '\n\nGo to profile to link GitHub?')) {
                    window.location.href = '/pages/profile.html';
                }
                return;
            }
            alert(data.message || 'Failed to create project');
            return;
        }

        const data = await response.json();

        // Add new project to beginning
        projects.unshift(data.project);

        // Switch to active tab
        currentTab = 'active';
        currentPage = 1;
        switchTab('active');
        renderProjects();

        // Reset form
        document.getElementById('createProjectForm').reset();
        selectedTagsSet.clear();
        tagButtons.forEach(btn => btn.classList.remove('active'));
        document.getElementById('selectedTags').value = '';
        // Reset repo slide box
        document.getElementById('githubRepo').value = '';
        document.getElementById('repoSelectedText').textContent = 'No repository';
        document.querySelectorAll('.repo-slidebox-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.repo === '');
        });
        document.getElementById('repoSlidebox').classList.remove('open');
        newProjectForm.style.display = 'none';

        console.log('Project created:', data.project);

    } catch (error) {
        console.error('Create project error:', error);
        alert('Failed to create project. Please try again.');
    }
});

// Tab button event listeners
document.getElementById('activeTab').addEventListener('click', () => switchTab('active'));
document.getElementById('pastTab').addEventListener('click', () => switchTab('past'));

// ========================================
// JOIN REQUEST MANAGEMENT
// ========================================

// Fetch all join requests for user's projects
async function fetchJoinRequests() {
    try {
        // Get all active projects
        const activeProjects = projects.filter(p => p.status === 'active');

        // Fetch requests for each project
        const requestsPromises = activeProjects.map(async (project) => {
            try {
                const response = await fetch(`/api/projects/${project.id}/requests`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.requests.map(req => ({
                        ...req,
                        projectName: project.name,
                        projectId: project.id
                    }));
                }
                return [];
            } catch (error) {
                console.error(`Failed to fetch requests for project ${project.id}:`, error);
                return [];
            }
        });

        const results = await Promise.all(requestsPromises);
        allJoinRequests = results.flat();

        // Update badge
        updateRequestsBadge();

    } catch (error) {
        console.error('Fetch join requests error:', error);
    }
}

// Update requests badge
function updateRequestsBadge() {
    const badge = document.getElementById('requestsBadge');
    const btn = document.getElementById('joinRequestsBtn');

    if (allJoinRequests.length > 0) {
        badge.textContent = allJoinRequests.length;
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }
}

// Render join requests in modal
function renderJoinRequests() {
    const container = document.getElementById('requestsContainer');

    if (allJoinRequests.length === 0) {
        container.innerHTML = `
            <div class="card card-centered">
                <p class="text-muted">No pending join requests</p>
            </div>
        `;
        return;
    }

    const requestsHTML = allJoinRequests.map(req => `
        <div class="request-card">
            <div class="request-header">
                <div>
                    <div class="request-user">${req.username}</div>
                    <div class="request-project">Project: ${req.projectName}</div>
                    <div class="request-time">${formatDate(req.created_at)}</div>
                </div>
            </div>
            ${req.message ? `<p class="card-desc">${req.message}</p>` : ''}
            <div class="request-actions">
                <button class="btn btn-primary" onclick="acceptRequest('${req.id}', '${req.projectId}')">
                    Accept
                </button>
                <button class="btn btn-outline" onclick="rejectRequest('${req.id}', '${req.projectId}')">
                    Reject
                </button>
            </div>
        </div>
    `).join('');

    container.innerHTML = requestsHTML;
}

// Format date helper
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
}

// Open requests modal
function openRequestsModal() {
    renderJoinRequests();
    document.getElementById('requestsModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// Close requests modal
function closeRequestsModal() {
    document.getElementById('requestsModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

// Accept request
async function acceptRequest(requestId, projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/requests/${requestId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept' })
        });

        const data = await response.json();

        if (response.ok) {
            // Build message based on GitHub invite result
            let msg = 'Request accepted! User added to project.';
            if (data.githubInvite) {
                if (data.githubInvite.sent && data.githubInvite.autoAccepted) {
                    msg = 'Request accepted! User added to project and GitHub repo.';
                } else if (data.githubInvite.sent) {
                    msg = 'Request accepted! User added to project. GitHub repo invite sent (pending acceptance).';
                } else {
                    msg = `Request accepted! User added to project. GitHub invite failed: ${data.githubInvite.error}`;
                }
            }
            alert(msg);
            // Remove from list
            allJoinRequests = allJoinRequests.filter(r => r.id !== requestId);
            updateRequestsBadge();
            renderJoinRequests();
        } else {
            alert(data.message || 'Failed to accept request');
        }

    } catch (error) {
        console.error('Accept request error:', error);
        alert('Failed to accept request. Please try again.');
    }
}

// Reject request
async function rejectRequest(requestId, projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/requests/${requestId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reject' })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Request rejected.');
            // Remove from list
            allJoinRequests = allJoinRequests.filter(r => r.id !== requestId);
            updateRequestsBadge();
            renderJoinRequests();
        } else {
            alert(data.message || 'Failed to reject request');
        }

    } catch (error) {
        console.error('Reject request error:', error);
        alert('Failed to reject request. Please try again.');
    }
}

// Event listeners for join requests modal
document.getElementById('joinRequestsBtn').addEventListener('click', openRequestsModal);
document.getElementById('closeRequestsModal').addEventListener('click', closeRequestsModal);

// Close modal on backdrop click
document.getElementById('requestsModal').addEventListener('click', (e) => {
    if (e.target.id === 'requestsModal') {
        closeRequestsModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('requestsModal').style.display === 'flex') {
        closeRequestsModal();
    }
});

// ========================================
// GITHUB REPO SLIDE BOX
// ========================================
let repoList = []; // Store fetched repos

// Render repo list filtered by search query
function renderRepoList(filter = '') {
    const listEl = document.getElementById('repoList');
    const selectedRepo = document.getElementById('githubRepo').value;
    const query = filter.toLowerCase();

    // Filter repos by search query
    const filtered = repoList.filter(repo =>
        repo.full_name.toLowerCase().includes(query)
    );

    // Always show "No repository" option (unless searching)
    let html = '';
    if (!query) {
        html += `<div class="repo-slidebox-item${selectedRepo === '' ? ' selected' : ''}" data-repo="" onclick="selectRepo('')">No repository</div>`;
    }

    if (filtered.length === 0 && query) {
        html += '<div class="repo-no-results">No matching repositories</div>';
    } else {
        filtered.forEach(repo => {
            const isSelected = selectedRepo === repo.full_name;
            const privateBadge = repo.private ? '<span class="repo-private-badge">Private</span>' : '';
            html += `<div class="repo-slidebox-item${isSelected ? ' selected' : ''}" data-repo="${repo.full_name}" onclick="selectRepo('${repo.full_name}')">${repo.full_name}${privateBadge}</div>`;
        });
    }

    listEl.innerHTML = html;
}

// Toggle slide box open/close
function toggleRepoSlidebox() {
    const box = document.getElementById('repoSlidebox');
    const searchInput = document.getElementById('repoSearchInput');
    const isOpen = box.classList.toggle('open');

    if (isOpen) {
        searchInput.value = '';
        renderRepoList();
        setTimeout(() => searchInput.focus(), 50);
    }
}

// Select a repo from the slide box
function selectRepo(fullName) {
    document.getElementById('githubRepo').value = fullName;
    document.getElementById('repoSelectedText').textContent = fullName || 'No repository';
    document.getElementById('repoSlidebox').classList.remove('open');
    document.getElementById('repoSearchInput').value = '';
    renderRepoList();
}

// Close slide box when clicking outside
document.addEventListener('click', (e) => {
    const box = document.getElementById('repoSlidebox');
    if (box && !box.contains(e.target)) {
        box.classList.remove('open');
    }
});

// Prevent panel clicks from toggling the slidebox
document.getElementById('repoPanel').addEventListener('click', (e) => {
    e.stopPropagation();
});

// Search input handler
document.getElementById('repoSearchInput').addEventListener('input', (e) => {
    renderRepoList(e.target.value);
});

// Load GitHub repos into slide box
async function loadGithubRepos() {
    const trigger = document.getElementById('repoTrigger');
    const hint = document.getElementById('githubRepoHint');

    try {
        // Check if GitHub is linked
        const statusRes = await fetch('/api/github/status');
        const statusData = await statusRes.json();

        // Save GitHub link status for use in type toggle
        githubLinked = statusData.linked;

        // Show warning immediately on load if GitHub not linked (default type is software)
        if (!githubLinked) {
            const typeHint = document.getElementById('projectTypeHint');
            typeHint.textContent = 'Software projects require a linked GitHub account.';
            typeHint.style.display = 'block';
            typeHint.style.color = 'var(--danger, #f85149)';
        }

        if (!statusData.linked) {
            trigger.disabled = true;
            return;
        }

        // Fetch repos
        const reposRes = await fetch('/api/github/repos');
        const reposData = await reposRes.json();

        if (!reposData.success || reposData.repos.length === 0) {
            trigger.disabled = true;
            hint.textContent = 'No repositories found on your GitHub account.';
            hint.style.display = 'block';
            return;
        }

        repoList = reposData.repos;
        trigger.disabled = false;
        hint.style.display = 'none';
        renderRepoList();

        // Attach trigger click
        trigger.addEventListener('click', toggleRepoSlidebox);

    } catch (error) {
        console.error('Load GitHub repos error:', error);
        hint.textContent = 'Failed to load repositories.';
        hint.style.display = 'block';
    }
}

// Fetch projects on page load
fetchProjects();
loadGithubRepos();
