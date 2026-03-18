// Project type definitions — add new types here only
const PROJECT_TYPES = {
  software: { label: 'Software', badgeClass: 'badge-type-software' },
  research: { label: 'Research', badgeClass: 'badge-type-research' },
};

// State
let projects = [];
let githubLinked = false;

// Pagination state
const PROJECTS_PER_PAGE = 4;
let currentPage = 1;
let currentTab = 'active'; // 'active' or 'past'

// Check if we should auto-open edit modal from URL param
function checkEditParam() {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');
    if (editId) {
        // Clean URL without reloading
        window.history.replaceState({}, '', window.location.pathname);
        openEditModal(editId);
    }
}

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

        // Auto-open edit modal if redirected from project detail page
        checkEditParam();

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
        'kicked': 'badge-kicked',
        'deleted': 'badge-deleted'
    };
    return badges[status] || 'badge-success';
}

// Get badge text based on status
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

// Render a single project card
function renderProjectCard(project) {
    const tagsHTML = project.tags && project.tags.length > 0
        ? `<div class="project-tags">${project.tags.map(tag => `<span class="project-tag">${tag}</span>`).join('')}</div>`
        : '';

    // Repo badge for software projects with a linked GitHub repo
    const repoTagHTML = project.projectType === 'software' && project.githubRepo
        ? `<span class="repo-tag"><img src="../pictures/icons/github.svg" width="14" height="14">${project.githubRepo}</span>`
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
                    ${project.status === 'completed' && project.role === 'creator' ? '<img src="../pictures/icons/purple-star.svg" width="20" height="20" title="Project Creator">' : ''}
                    ${repoTagHTML}
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
            p.status === 'completed' || p.status === 'left' || p.status === 'kicked' || p.status === 'deleted'
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
            showToast(data.message || 'Failed to create project', 'error');
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
        showToast('Failed to create project. Please try again.', 'error');
    }
});

// Tab button event listeners
document.getElementById('activeTab').addEventListener('click', () => switchTab('active'));
document.getElementById('pastTab').addEventListener('click', () => switchTab('past'));

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

// ========================================
// EDIT PROJECT MODAL
// ========================================
let editSelectedTags = new Set();
const editTagButtons = document.querySelectorAll('.edit-tag-btn');

// Edit tag button click handlers
editTagButtons.forEach(btn => {
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

// Edit recruitment toggle
document.querySelectorAll('.edit-recruit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.edit-recruit-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('editRecruitmentOpen').value = btn.dataset.recruit;
    });
});

// Open edit modal and populate with project data
function openEditModal(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Block editing non-active projects
    if (project.status !== 'active') return;

    // Set project ID
    document.getElementById('editProjectId').value = project.id;

    // Set name and description
    document.getElementById('editProjectName').value = project.name;
    document.getElementById('editProjectDescription').value = project.description;

    // Project type and github repo are immutable — just preserve values
    const isSoftware = (project.projectType || 'software') === 'software';
    document.getElementById('editProjectType').value = project.projectType || 'software';
    document.getElementById('editGithubRepo').value = project.githubRepo || '';

    // Show/hide sections based on type
    document.getElementById('editLookingForGroup').style.display = isSoftware ? 'block' : 'none';
    document.getElementById('editPresetTagsGroup').style.display = isSoftware ? 'flex' : 'none';

    // Set tags — separate preset tags from custom tags
    const presetTagNames = ['Frontend', 'Backend', 'Mobile', 'Design', 'AI/ML', 'DevOps'];
    editSelectedTags.clear();
    const customTags = [];

    (project.tags || []).forEach(tag => {
        if (presetTagNames.includes(tag)) {
            editSelectedTags.add(tag);
        } else {
            customTags.push(tag);
        }
    });

    editTagButtons.forEach(btn => {
        btn.classList.toggle('active', editSelectedTags.has(btn.dataset.tag));
    });
    document.getElementById('editCustomTags').value = customTags.join(', ');

    // Set looking for roles
    document.querySelectorAll('.edit-role-checkbox').forEach(cb => {
        cb.checked = (project.lookingFor || []).includes(cb.value);
    });

    // Set recruitment status
    const isOpen = project.recruitmentOpen !== false;
    document.getElementById('editRecruitmentOpen').value = isOpen ? 'true' : 'false';
    document.querySelectorAll('.edit-recruit-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.recruit === String(isOpen));
    });

    // Show complete/delete buttons only for creator
    const deleteSection = document.getElementById('editDeleteSection');
    deleteSection.style.display = project.role === 'creator' ? 'block' : 'none';

    // Hide complete button if project is not active
    const completeBtn = document.getElementById('editCompleteBtn');
    completeBtn.style.display = project.status === 'active' ? 'block' : 'none';

    // Set up delete confirmation — show project name hint, reset input
    document.getElementById('deleteProjectNameHint').textContent = project.name;
    document.getElementById('deleteConfirmInput').value = '';
    document.getElementById('editDeleteBtn').disabled = true;

    // Show modal
    document.getElementById('editModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// Close edit modal
function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

document.getElementById('closeEditModal').addEventListener('click', closeEditModal);
document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);

// Close on backdrop click
document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') closeEditModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('editModal').style.display === 'flex') {
        closeEditModal();
    }
});

// Complete project from edit modal
document.getElementById('editCompleteBtn').addEventListener('click', async () => {
    const projectId = document.getElementById('editProjectId').value;
    if (!confirm('Mark this project as completed? Members will remain but recruitment will close.')) return;

    try {
        const response = await fetch(`/api/projects/${projectId}/complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (response.ok) {
            closeEditModal();
            // Update local state
            const idx = projects.findIndex(p => p.id === projectId);
            if (idx !== -1) {
                projects[idx].status = 'completed';
                projects[idx].recruitmentOpen = false;
            }
            renderProjects();
        } else {
            showToast(data.message || 'Failed to complete project', 'error');
        }
    } catch (error) {
        console.error('Complete project error:', error);
        showToast('Failed to complete project. Please try again.', 'error');
    }
});

// Enable/disable delete button based on name confirmation input
document.getElementById('deleteConfirmInput').addEventListener('input', (e) => {
    const expected = document.getElementById('deleteProjectNameHint').textContent;
    document.getElementById('editDeleteBtn').disabled = e.target.value !== expected;
});

// Delete project from edit modal
document.getElementById('editDeleteBtn').addEventListener('click', async () => {
    const projectId = document.getElementById('editProjectId').value;

    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (response.ok) {
            closeEditModal();
            // Update local state — mark as deleted
            const idx = projects.findIndex(p => p.id === projectId);
            if (idx !== -1) projects[idx].status = 'deleted';
            renderProjects();
        } else {
            showToast(data.message || 'Failed to delete project', 'error');
        }
    } catch (error) {
        console.error('Delete project error:', error);
        showToast('Failed to delete project. Please try again.', 'error');
    }
});

// Handle edit form submission
document.getElementById('editProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const projectId = document.getElementById('editProjectId').value;
    const name = document.getElementById('editProjectName').value.trim();
    const description = document.getElementById('editProjectDescription').value.trim();
    const projectType = document.getElementById('editProjectType').value;

    // Collect tags
    const customTagsInput = document.getElementById('editCustomTags').value.trim();
    const customTags = customTagsInput ? customTagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
    const tags = [...Array.from(editSelectedTags), ...customTags];

    // Collect roles
    const roleCheckboxes = document.querySelectorAll('.edit-role-checkbox:checked');
    const lookingFor = Array.from(roleCheckboxes).map(cb => cb.value);

    const githubRepo = document.getElementById('editGithubRepo').value || null;
    const recruitmentOpen = document.getElementById('editRecruitmentOpen').value === 'true';

    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, tags, lookingFor, recruitmentOpen, githubRepo, projectType })
        });

        const data = await response.json();

        if (!response.ok) {
            showToast(data.message || 'Failed to update project', 'error');
            return;
        }

        // Update local project data
        const idx = projects.findIndex(p => p.id === projectId);
        if (idx !== -1) {
            projects[idx] = { ...projects[idx], name, description, tags, lookingFor, recruitmentOpen, githubRepo, projectType };
        }

        closeEditModal();
        renderProjects();

    } catch (error) {
        console.error('Update project error:', error);
        showToast('Failed to update project. Please try again.', 'error');
    }
});

// Fetch projects on page load, then reveal content
(async function initProjects() {
    await Promise.all([fetchProjects(), loadGithubRepos()]);
    showMainContent();
})();
