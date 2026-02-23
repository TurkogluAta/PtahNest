// Get project ID from URL
const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');

if (!projectId) {
    alert('No project ID provided');
    window.location.href = '/pages/projects.html';
}

// State
let project = null;
let members = [];
let currentUserId = null;

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
        alert('Failed to load project. Redirecting...');
        window.location.href = '/pages/projects.html';
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
            currentUserId = data.currentUserId; // Get current user ID from backend
            renderMembers();
            renderProjectDetails();
            renderActions();
        } else {
            // User not authorized to view members
            const data = await response.json();
            alert(data.message || 'You are not authorized to view this project');
            window.location.href = '/pages/projects.html';
        }
    } catch (error) {
        console.error('Fetch members error:', error);
        alert('Failed to load project members');
    }
}

// Render project header
function renderProjectHeader() {
    const headerHTML = `
        <div class="flex-between-start">
            <div>
                <h1 class="hero-title">${project.name}</h1>
                <p class="text-muted">Created by ${project.creator_username}</p>
            </div>
            <span class="badge ${getBadgeClass(project.status)}">${getBadgeText(project.status)}</span>
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
function renderMembers() {
    if (members.length === 0) {
        document.getElementById('membersContainer').innerHTML = `
            <div class="card">
                <p class="text-muted">No members yet</p>
            </div>
        `;
        return;
    }

    const membersHTML = members.map(member => `
        <div class="card card-sm card-bottom-gap">
            <div class="flex-between-center">
                <div>
                    <div class="member-name">${member.username}</div>
                    <div class="member-role">
                        ${member.role === 'creator' ? 'Project Creator' : 'Team Member'}
                    </div>
                    <div class="member-joined">
                        Joined ${formatDate(member.joined_at)}
                    </div>
                </div>
                ${member.role === 'creator' ? '<span class="badge badge-success">Creator</span>' : ''}
            </div>
        </div>
    `).join('');

    document.getElementById('membersContainer').innerHTML = membersHTML;
}

// Render action buttons (role-based)
function renderActions() {
    // Don't show actions if project is deleted
    if (project.status === 'deleted') {
        document.getElementById('actionsSection').innerHTML = `
            <div class="card card-sm card-centered">
                <p class="text-muted">This project has been deleted</p>
            </div>
        `;
        return;
    }

    const isCreator = project.creator_id === currentUserId;
    const isMember = members.some(m => m.user_id === currentUserId && m.role !== 'creator');

    let actionsHTML = '<div class="action-row">';

    if (isCreator) {
        // Creator actions: Edit + Delete
        actionsHTML += `
            <button class="btn btn-primary" onclick="editProject()">Edit Project</button>
            <button class="btn btn-outline btn-danger" onclick="deleteProject()">Delete Project</button>
        `;
    } else if (isMember) {
        // Member action: Leave
        actionsHTML += `
            <button class="btn btn-outline btn-danger" onclick="leaveProject()">Leave Project</button>
        `;
    }

    actionsHTML += '</div>';

    document.getElementById('actionsSection').innerHTML = actionsHTML;
}

// Edit project (placeholder for future implementation)
function editProject() {
    alert('Edit functionality will be implemented in a future update.');
    // TODO: Implement edit modal or redirect to edit page
}

// Delete project
async function deleteProject() {
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            data = { message: text || 'An error occurred' };
        }

        if (response.ok) {
            alert('Project deleted successfully');
            window.location.href = '/pages/projects.html';
        } else {
            alert(data.message || 'Failed to delete project');
        }
    } catch (error) {
        console.error('Delete project error:', error);
        alert('Failed to delete project. Please try again.');
    }
}

// Leave project
async function leaveProject() {
    if (!confirm('Are you sure you want to leave this project? It will appear in your Past projects.')) {
        return;
    }

    try {
        const response = await fetch(`/api/projects/${projectId}/leave`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            data = { message: text || 'An error occurred' };
        }

        if (response.ok) {
            alert('You have left the project');
            window.location.href = '/pages/projects.html';
        } else {
            alert(data.message || 'Failed to leave project');
        }
    } catch (error) {
        console.error('Leave project error:', error);
        alert('Failed to leave project. Please try again.');
    }
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
// COMMIT HISTORY
// ========================================
let commitPage = 1;
let commitHasNext = false;
let commitLoading = false;
let allCommits = [];

// Fetch commits for current page
async function fetchCommits(page = 1) {
    if (!project || !project.github_repo) return;

    const section = document.getElementById('commitsSection');
    const container = document.getElementById('commitsContainer');
    section.style.display = 'block';

    if (page === 1) {
        container.innerHTML = '<div class="commits-loading">Loading commits...</div>';
    }

    commitLoading = true;

    try {
        const response = await fetch(`/api/github/commits/${projectId}?page=${page}`);
        const data = await response.json();

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

        if (page === 1) allCommits = [];
        allCommits = allCommits.concat(data.commits);

        commitPage = data.page;
        commitHasNext = data.hasNextPage;
        commitLoading = false;

        renderCommits();
    } catch (error) {
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
                            <a class="commit-sha" href="${commit.url}" target="_blank" rel="noopener">${commit.sha.substring(0, 7)}</a>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    container.innerHTML = html;

    // Render pagination
    let paginationHTML = '';
    if (commitPage > 1 || commitHasNext) {
        if (commitPage > 1) {
            paginationHTML += `<button class="pagination-btn" onclick="loadCommitPage(${commitPage - 1})">Previous</button>`;
        }
        paginationHTML += `<span class="pagination-btn active">${commitPage}</span>`;
        if (commitHasNext) {
            paginationHTML += `<button class="pagination-btn" onclick="loadCommitPage(${commitPage + 1})">Next</button>`;
        }
    }
    pagination.innerHTML = paginationHTML;
}

// Load specific commit page (replaces current view)
function loadCommitPage(page) {
    allCommits = [];
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

// Initialize on page load
fetchProjectDetails();
