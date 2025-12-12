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

        // Fetch members
        await fetchMembers();

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
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
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
        ? `<div style="margin-top: 1rem;">
             <div class="input-label">Tags</div>
             <div class="project-tags">${project.tags.map(tag => `<span class="project-tag">${tag}</span>`).join('')}</div>
           </div>`
        : '';

    const lookingForHTML = project.lookingFor && project.lookingFor.length > 0
        ? `<div style="margin-top: 1rem;">
             <div class="input-label">Looking For</div>
             <div class="project-looking-for" style="border-top: none; padding-top: 0;">
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
        <div style="margin-top: 1rem;">
            <div class="input-label">Project Info</div>
            <div class="project-meta" style="margin-top: 0.5rem;">
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
        <div class="card card-bottom-gap" style="padding: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600; color: var(--text-1);">${member.username}</div>
                    <div style="font-size: 0.85rem; color: var(--text-2); margin-top: 0.25rem;">
                        ${member.role === 'creator' ? 'Project Creator' : 'Team Member'}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-3); margin-top: 0.25rem;">
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
            <div class="card" style="padding: 1rem; text-align: center;">
                <p class="text-muted">This project has been deleted</p>
            </div>
        `;
        return;
    }

    const isCreator = project.creator_id === currentUserId;
    const isMember = members.some(m => m.user_id === currentUserId && m.role !== 'creator');

    let actionsHTML = '<div style="display: flex; gap: 1rem;">';

    if (isCreator) {
        // Creator actions: Edit + Delete
        actionsHTML += `
            <button class="btn btn-primary" onclick="editProject()">Edit Project</button>
            <button class="btn btn-outline" style="color: #ef4444; border-color: #ef4444;" onclick="deleteProject()">Delete Project</button>
        `;
    } else if (isMember) {
        // Member action: Leave
        actionsHTML += `
            <button class="btn btn-outline" style="color: #ef4444; border-color: #ef4444;" onclick="leaveProject()">Leave Project</button>
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

// Initialize on page load
fetchProjectDetails();
