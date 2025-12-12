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

        // Limit to 4 projects for dashboard preview
        const previewProjects = projects.slice(0, 4);

        renderProjects(previewProjects);
    } catch (error) {
        console.error('Fetch projects error:', error);
    }
}

// Fetch and render discover projects
async function fetchDiscoverProjects() {
    try {
        const response = await fetch('/api/projects/discover', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch discover projects');
        }

        const data = await response.json();
        const projects = data.projects || [];

        // Limit to 3 projects for dashboard preview
        const previewProjects = projects.slice(0, 3);

        renderDiscoverProjects(previewProjects);
    } catch (error) {
        console.error('Fetch discover projects error:', error);
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
        const badgeClass = getBadgeClass(project.status);
        const badgeText = getBadgeText(project.status);

        return `
            <div class="card card-hover card-bottom-gap">
                <div class="project-card-header">
                    <div>
                        <div class="card-title">${project.name}</div>
                        <div class="card-desc no-margin">${project.description}</div>
                    </div>
                    <span class="badge ${badgeClass}">${badgeText}</span>
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

// Render discover projects
function renderDiscoverProjects(projects) {
    const grid = document.getElementById('discoverProjectsContainer');

    if (!grid) return;

    if (projects.length === 0) {
        grid.innerHTML = '<p class="text-muted">No projects available</p>';
        return;
    }

    const projectsHTML = projects.map(project => {
        const tagsHTML = project.tags && project.tags.length > 0
            ? project.tags.slice(0, 2).map(tag => `<span class="tag">#${tag}</span>`).join('')
            : '';

        return `
            <div class="card card-hover">
                <div class="card-title">${project.name}</div>
                <div class="card-desc">${project.description}</div>
                <div class="card-tags">
                    ${tagsHTML}
                </div>
            </div>
        `;
    }).join('');

    grid.innerHTML = projectsHTML;
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

        // Fetch data
        fetchUserProjects();
        fetchDiscoverProjects();
    }
}

initDashboard();
