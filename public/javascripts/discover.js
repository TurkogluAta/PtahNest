// Project type definitions — add new types here only
const PROJECT_TYPES = {
  software: { label: 'Software', badgeClass: 'badge-type-software' },
  research: { label: 'Research', badgeClass: 'badge-type-research' },
};

// State
let discoverProjects = [];

// Pagination state
const PROJECTS_PER_PAGE = 4;
let currentPage = 1;
let isUserLoggedIn = false;

// Check if user is logged in (async)
async function checkUserAuth() {
    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            isUserLoggedIn = true;
        } else {
            isUserLoggedIn = false;
        }
    } catch (error) {
        console.error('Auth check error:', error);
        isUserLoggedIn = false;
    }
}

// Filter state
let selectedTags = new Set();
let selectedRoles = new Set();
let searchQuery = '';

// Fetch discover projects
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
        discoverProjects = data.projects;
        renderProjects();

    } catch (error) {
        console.error('Fetch discover projects error:', error);
        document.getElementById('projectsGrid').innerHTML = `
            <div class="card" style="grid-column: 1 / -1; text-align: center;">
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

// Filter projects based on current filter state
function getFilteredProjects() {
    return discoverProjects.filter(p => {
        // MUST be active AND recruitmentOpen
        if (p.status !== 'active' || !p.recruitmentOpen) {
            return false;
        }

        // Tag filter (AND logic - project must have ALL selected tags)
        if (selectedTags.size > 0) {
            const hasAllTags = Array.from(selectedTags).every(tag =>
                p.tags.includes(tag)
            );
            if (!hasAllTags) return false;
        }

        // Role filter (OR logic - project must have AT LEAST ONE selected role)
        if (selectedRoles.size > 0) {
            const hasAnyRole = Array.from(selectedRoles).some(role =>
                p.lookingFor.includes(role)
            );
            if (!hasAnyRole) return false;
        }

        // Search filter (case-insensitive, matches name or description)
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchesSearch =
                p.name.toLowerCase().includes(query) ||
                p.description.toLowerCase().includes(query);
            if (!matchesSearch) return false;
        }

        return true;
    });
}

// Render a single project card (clickable)
function renderProjectCard(project) {
    const tagsHTML = project.tags && project.tags.length > 0
        ? `<div class="project-tags">${project.tags.map(tag =>
            `<span class="project-tag">${tag}</span>`).join('')}</div>`
        : '';

    // Repo badge for software projects with a linked GitHub repo
    const repoTagHTML = project.projectType === 'software' && project.githubRepo
        ? `<span class="repo-tag"><img src="../pictures/icons/github.svg" width="14" height="14"><span class="repo-tag-name">${project.githubRepo}</span></span>`
        : '';

    const lookingForHTML = project.lookingFor && project.lookingFor.length > 0
        ? `<div class="project-looking-for">
             <span class="looking-for-label">Looking for:</span>
             ${project.lookingFor.map(role =>
            `<span class="role-tag">${role}</span>`).join('')}
           </div>`
        : '';

    return `
        <div class="card card-hover" onclick="openProjectModal('${project.id}')"
             style="cursor: pointer;">
            <div class="project-card-header">
                <div class="card-title">${project.name}</div>
                <div class="badge-group" style="flex-wrap: wrap; margin-bottom: 0.5rem;">
                    ${repoTagHTML}
                    ${(() => { const t = PROJECT_TYPES[project.projectType] || PROJECT_TYPES.software; return `<span class="badge ${t.badgeClass}">${t.label}</span>`; })()}
                    <span class="badge badge-success">Recruiting</span>
                </div>
                <div class="card-desc no-margin">${project.description}</div>
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
    const paginationContainer = document.getElementById('discoverPagination');

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    const prevBtn = currentPage > 1
        ? `<button class="pagination-btn" onclick="changePage(${currentPage - 1})">Previous</button>`
        : `<button class="pagination-btn" disabled>Previous</button>`;

    const nextBtn = currentPage < totalPages
        ? `<button class="pagination-btn" onclick="changePage(${currentPage + 1})">Next</button>`
        : `<button class="pagination-btn" disabled>Next</button>`;

    paginationContainer.innerHTML = `
        ${prevBtn}
        <button class="pagination-btn active">${currentPage} / ${totalPages}</button>
        ${nextBtn}
    `;
}

// Change page
function changePage(page) {
    currentPage = page;
    renderProjects();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Render all projects with pagination
function renderProjects() {
    const container = document.getElementById('projectsGrid');
    const filteredProjects = getFilteredProjects();

    // Update project count
    const countText = filteredProjects.length === 1 ? '1 project' : `${filteredProjects.length} projects`;
    document.getElementById('projectCount').textContent = countText;

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
            <div class="card" style="grid-column: 1 / -1; text-align: center;">
                <p class="text-muted">No projects found matching your filters.</p>
                <p class="text-muted" style="font-size: 0.85rem;">Try adjusting your search criteria.</p>
            </div>
        `;
        document.getElementById('discoverPagination').innerHTML = '';
    }
}

// Tag filter button handlers
document.querySelectorAll('.filter-tag').forEach(btn => {
    btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-filter-tag');
        if (selectedTags.has(tag)) {
            selectedTags.delete(tag);
            btn.classList.remove('active');
        } else {
            selectedTags.add(tag);
            btn.classList.add('active');
        }
        currentPage = 1; // Reset to first page
        renderProjects();
    });
});

// Role filter button handlers
document.querySelectorAll('.filter-role').forEach(btn => {
    btn.addEventListener('click', () => {
        const role = btn.getAttribute('data-filter-role');
        if (selectedRoles.has(role)) {
            selectedRoles.delete(role);
            btn.classList.remove('active');
        } else {
            selectedRoles.add(role);
            btn.classList.add('active');
        }
        currentPage = 1;
        renderProjects();
    });
});

// Search input handler (debounced)
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        searchQuery = e.target.value.trim();
        currentPage = 1;
        renderProjects();
    }, 300); // 300ms debounce
});

// Clear filters
document.getElementById('clearFilters').addEventListener('click', () => {
    selectedTags.clear();
    selectedRoles.clear();
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('.filter-tag, .filter-role').forEach(btn => {
        btn.classList.remove('active');
    });
    currentPage = 1;
    renderProjects();
});

// Open project detail modal
function openProjectModal(projectId) {
    const project = discoverProjects.find(p => p.id === projectId);
    if (!project) return;

    const tagsHTML = project.tags && project.tags.length > 0
        ? `<div class="project-tags">${project.tags.map(tag =>
            `<span class="project-tag">${tag}</span>`).join('')}</div>`
        : '';

    // Repo badge for software projects with a linked GitHub repo
    const modalRepoTagHTML = project.projectType === 'software' && project.githubRepo
        ? `<span class="repo-tag"><img src="../pictures/icons/github.svg" width="14" height="14"><span class="repo-tag-name">${project.githubRepo}</span></span>`
        : '';

    const lookingForHTML = project.lookingFor && project.lookingFor.length > 0
        ? `<div class="project-looking-for">
             <span class="looking-for-label">Looking for:</span>
             ${project.lookingFor.map(role =>
            `<span class="role-tag">${role}</span>`).join('')}
           </div>`
        : '';

    // Join button based on auth status
    const joinButtonHTML = isUserLoggedIn
        ? `<button class="btn btn-primary" onclick="joinProject('${projectId}')">
             Send Join Request
           </button>`
        : `<a href="auth.html" class="btn btn-primary">
             Login to Join
           </a>`;

    // Initial chat message field (only for logged-in users)
    const introMessageHTML = isUserLoggedIn
        ? `<div class="join-intro-group">
             <div class="input-label">Introduce yourself <span class="join-intro-label-hint">(optional, max 500 chars)</span></div>
             <textarea id="joinIntroMessage" class="input-field" rows="3" maxlength="500"
                placeholder="Hi! I'd like to join because..."></textarea>
             <div class="join-intro-help">This becomes the first message in your chat with the project team.</div>
           </div>`
        : '';

    const modalContent = `
        <div class="card-title" style="font-size: 1.5rem; margin-bottom: 1rem;">
            ${project.name}
        </div>

        <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
            ${modalRepoTagHTML}
            <span class="badge badge-success">Recruiting</span>
            <span class="meta-inline">
                <img src="../pictures/icons/members.svg" width="16">
                ${project.members} Members
            </span>
        </div>

        <div style="margin-bottom: 1rem;">
            <div class="input-label">About This Project</div>
            <p class="card-desc">${project.description}</p>
        </div>

        ${tagsHTML}
        ${lookingForHTML}

        <div style="margin-top: 1.5rem;">
            <div class="input-label">Project Creator</div>
            <p class="card-desc">${project.creator_username || 'Anonymous'}</p>
        </div>

        ${introMessageHTML}

        <div style="margin-top: 2rem; display: flex; gap: 1rem;">
            ${joinButtonHTML}
            <button class="btn btn-outline" onclick="closeProjectModal()">Close</button>
        </div>
    `;

    document.getElementById('modalBody').innerHTML = modalContent;
    document.getElementById('projectModal').style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

// Close modal
function closeProjectModal() {
    document.getElementById('projectModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

// Join project
async function joinProject(projectId) {
    try {
        // Read optional intro message from modal textarea
        const introInput = document.getElementById('joinIntroMessage');
        const introMessage = introInput ? introInput.value.trim() : '';

        const response = await fetch(`/api/projects/${projectId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(introMessage ? { message: introMessage } : {})
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Join request sent successfully! The project creator will review your request.', 'success', 5000);
            closeProjectModal();
            // Remove project from discover list
            discoverProjects = discoverProjects.filter(p => p.id !== projectId);
            renderProjects();
        } else if (data.githubRequired) {
            // Software project but user has no GitHub linked
            if (confirm(data.message + '\n\nGo to profile to link GitHub?')) {
                window.location.href = '/pages/profile.html';
            }
        } else {
            showToast(data.message || 'Failed to send join request', 'error');
        }

    } catch (error) {
        console.error('Join project error:', error);
        showToast('Failed to send join request. Please try again.', 'error');
    }
}

// Close modal on backdrop click
document.getElementById('projectModal').addEventListener('click', (e) => {
    if (e.target.id === 'projectModal') {
        closeProjectModal();
    }
});

// Close modal with close button
document.getElementById('closeModal').addEventListener('click', closeProjectModal);

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeProjectModal();
    }
});

// Initialize page
(async function initPage() {
    await checkUserAuth();
    await fetchDiscoverProjects();
    showMainContent();
})();
