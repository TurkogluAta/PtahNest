// Project type definitions — add new types here only
const PROJECT_TYPES = {
  software: { label: 'Software', badgeClass: 'badge-type-software' },
  research: { label: 'Research', badgeClass: 'badge-type-research' },
};

// Fetch and render user projects
async function fetchUserProjects() {
    try {
        const response = await fetch('/api/projects', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch projects');
        }

        const data = await response.json();
        const projects = data.projects || [];

        // Update dashboard stats from real data
        updateDashboardStats(projects);

        // Only show active projects on dashboard
        const previewProjects = projects.filter(p => p.status === 'active').slice(0, 4);

        renderProjects(previewProjects);
    } catch (error) {
        console.error('Fetch projects error:', error);
    }
}


// Render user projects
function renderProjects(projects) {
    const container = document.getElementById('myProjectsContainer');

    if (!container) return;

    if (projects.length === 0) {
        container.innerHTML = '<p class="text-muted">No projects yet</p>';
        return;
    }

    const projectsHTML = projects.map(project => {
        // Repo badge for software projects
        const repoTagHTML = project.projectType === 'software' && project.githubRepo
            ? `<span class="repo-tag"><img src="../pictures/icons/github.svg" width="14" height="14">${project.githubRepo}</span>`
            : '';

        return `
            <div class="card card-hover card-bottom-gap card-clickable" onclick="window.location.href='/pages/project-detail.html?id=${project.id}'">
                <div class="project-card-header">
                    <div>
                        <div class="card-title">${project.name}</div>
                        <div class="card-desc no-margin">${project.description}</div>
                    </div>
                    <div class="badge-group">
                        ${repoTagHTML}
                        ${(() => { const t = PROJECT_TYPES[project.projectType] || PROJECT_TYPES.software; return `<span class="badge ${t.badgeClass}">${t.label}</span>`; })()}
                        <span class="badge ${getBadgeClass(project.status)}">${getBadgeText(project.status)}</span>
                    </div>
                </div>
                <div class="project-meta">
                    <span class="meta-inline">
                        <img src="../pictures/icons/members.svg" width="16">
                        ${project.members || 0} Members
                    </span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = projectsHTML;
}


// Update purple star count and projects finished from real data
function updateDashboardStats(projects) {
    // Purple stars = completed projects where user is the creator
    const purpleStarCount = projects.filter(p => p.status === 'completed' && p.role === 'creator').length;
    const purpleStarEl = document.querySelector('.purple-star-num');
    if (purpleStarEl) purpleStarEl.textContent = purpleStarCount;

    // Projects finished = all completed projects (creator or member)
    const finishedCount = projects.filter(p => p.status === 'completed').length;
    const finishedEl = document.querySelector('.stat-val');
    if (finishedEl) finishedEl.textContent = finishedCount;
}

// Helper functions for badge classes
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

// Run auth check and fetch data when script loads
async function initDashboard() {
    const user = await checkAuth();
    if (user) {
        // Update welcome message with username
        const welcomeTitle = document.querySelector('.hero-title');
        if (welcomeTitle) {
            welcomeTitle.textContent = `Welcome back, ${user.username}`;
        }

        // Fetch data then reveal page
        await fetchUserProjects();
        showMainContent();
    }
}

initDashboard();
