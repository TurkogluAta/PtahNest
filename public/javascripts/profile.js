let currentUser = null;

// Load and display current user's profile data
async function loadUserProfile() {
    try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();

        if (response.ok && data.user) {
            currentUser = data.user;
            renderAccountInfo(data.user);
        } else {
            showToast('Failed to load profile', 'error');
        }
    } catch (error) {
        console.error('Error loading user profile:', error);
        showToast('Failed to load profile', 'error');
    }
}

// Render the account info display section
function renderAccountInfo(user) {
    document.getElementById('displayUsername').textContent = user.username;
    document.getElementById('displayEmail').textContent = user.email;

    // Hero section
    document.getElementById('profileAvatarLarge').textContent = user.username.charAt(0).toUpperCase();
    document.getElementById('heroUsername').textContent = user.username;
    if (user.created_at) {
        const joined = new Date(user.created_at).toLocaleDateString('en-IE', { year: 'numeric', month: 'long', day: 'numeric' });
        document.getElementById('heroMeta').textContent = `Member since ${joined}`;
    }
}

// Open inline edit form
function openEditInfo() {
    document.getElementById('editUsername').value = currentUser ? currentUser.username : '';
    document.getElementById('editEmail').value = currentUser ? currentUser.email : '';
    document.getElementById('profileInfoDisplay').style.display = 'none';
    document.getElementById('profileInfoEdit').style.display = 'block';
    document.getElementById('editInfoBtn').style.display = 'none';
}

// Close inline edit form
function closeEditInfo() {
    document.getElementById('profileInfoDisplay').style.display = 'block';
    document.getElementById('profileInfoEdit').style.display = 'none';
    document.getElementById('editInfoBtn').style.display = '';
}

// Submit account info changes
async function submitEditInfo() {
    const username = document.getElementById('editUsername').value.trim();
    const email = document.getElementById('editEmail').value.trim();

    if (!username || !email) {
        showToast('Username and email are required', 'error');
        return;
    }

    // Skip API call if nothing changed
    if (username === currentUser.username && email === currentUser.email) {
        closeEditInfo();
        return;
    }

    try {
        const res = await fetch('/api/auth/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });
        const data = await res.json();

        if (data.success) {
            currentUser = { ...currentUser, ...data.user };
            renderAccountInfo(currentUser);
            closeEditInfo();
            showToast('Profile updated', 'success');
        } else {
            showToast(data.message || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Update profile error:', error);
        showToast('Failed to update profile', 'error');
    }
}

// Submit password change
async function submitChangePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('All password fields are required', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match', 'error');
        return;
    }

    try {
        const res = await fetch('/api/auth/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();

        if (data.success) {
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            showToast('Password updated successfully', 'success');
        } else {
            showToast(data.message || 'Failed to update password', 'error');
        }
    } catch (error) {
        console.error('Change password error:', error);
        showToast('Failed to update password', 'error');
    }
}

// Check URL params for OAuth callback result
function checkGithubCallback() {
    const params = new URLSearchParams(window.location.search);
    const githubResult = params.get('github');
    const reason = params.get('reason');

    if (!githubResult) return;

    const messageEl = document.getElementById('githubMessage');
    messageEl.style.display = 'block';

    if (githubResult === 'success') {
        messageEl.className = 'github-message github-message-success';
        messageEl.textContent = 'GitHub account linked successfully!';
    } else {
        messageEl.className = 'github-message github-message-error';
        const messages = {
            already_linked: 'This GitHub account is already linked to another user.',
            state_mismatch: 'Security validation failed. Please try again.',
            token_failed: 'Failed to get access token from GitHub.',
            user_fetch_failed: 'Failed to fetch GitHub user info.',
            server_error: 'Server error occurred. Please try again.',
            no_code: 'No authorization code received from GitHub.'
        };
        messageEl.textContent = messages[reason] || 'An error occurred linking your GitHub account.';
    }

    window.history.replaceState({}, '', window.location.pathname);
}

// Load GitHub connection status and update UI
async function loadGithubStatus() {
    const statusEl = document.getElementById('githubStatus');
    const actionsEl = document.getElementById('githubActions');

    try {
        const response = await fetch('/api/github/status');
        const data = await response.json();

        if (data.linked) {
            statusEl.textContent = data.github_username;
            actionsEl.innerHTML = `<button class="btn btn-outline" onclick="unlinkGithub()">Unlink GitHub</button>`;
        } else {
            statusEl.textContent = 'Not connected';
            actionsEl.innerHTML = `<a href="/api/github/auth" class="btn btn-primary">Link GitHub</a>`;
        }
    } catch (error) {
        console.error('Error loading GitHub status:', error);
        statusEl.textContent = 'Error loading status';
        actionsEl.innerHTML = '';
    }
}

// Unlink GitHub account
async function unlinkGithub() {
    showConfirm(
        'Unlink your GitHub account? You will lose access to commit history and GitHub features in software projects until you re-link.',
        async () => {
            try {
                const response = await fetch('/api/github/unlink', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await response.json();

                if (data.success) {
                    showToast('GitHub account unlinked', 'success');
                    loadGithubStatus();
                } else if (data.blockedProjects && data.blockedProjects.length > 0) {
                    // Show which projects are blocking the unlink
                    const projectNames = data.blockedProjects.map(p => p.name).join(', ');
                    showToast(`Cannot unlink: active in software project(s): ${projectNames}`, 'error', 6000);
                } else {
                    showToast(data.message || 'Failed to unlink GitHub account', 'error');
                }
            } catch (error) {
                console.error('Error unlinking GitHub:', error);
                showToast('Failed to unlink GitHub account', 'error');
            }
        },
        { confirmText: 'Unlink', danger: true }
    );
}

// Certificates
const CERTS_PER_PAGE = 6;
let certsPage = 1;
let certsData = [];


function renderCertificatesPage() {
    const grid = document.getElementById('certificatesGrid');
    const pagination = document.getElementById('certsPagination');
    if (!grid) return;

    const triggerLabel = { left: 'Left', kicked: 'Kicked', completed: 'Completed', deleted: 'Deleted' };
    const triggerColor = { left: '#8b949e', kicked: '#f85149', completed: '#3fb950', deleted: '#8b949e' };

    const totalPages = Math.ceil(certsData.length / CERTS_PER_PAGE);
    const start = (certsPage - 1) * CERTS_PER_PAGE;
    const page = certsData.slice(start, start + CERTS_PER_PAGE);

    grid.innerHTML = page.map(c => {
        const avgRating = c.avg_rating ? parseFloat(c.avg_rating) : null;
        const ratingHtml = avgRating != null
            ? `<span class="certificate-card-rating">★ ${avgRating.toFixed(1)}</span>`
            : '';
        return `
        <a href="/pages/certificate.html?id=${c.id}" class="certificate-card">
            <div class="certificate-card-name">
                ${c.was_creator ? '<span class="cert-creator-star">★</span>' : ''}${c.project_name || 'Project'}
            </div>
            <div class="certificate-card-meta">
                <span class="certificate-trigger-badge cert-trigger-${c.trigger_type || 'default'}">${triggerLabel[c.trigger_type] || c.trigger_type}</span>
                ${ratingHtml}
                <span class="certificate-card-date">${new Date(c.issued_at).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
        </a>`;
    }).join('');

    if (!pagination) return;
    if (totalPages <= 1) { pagination.innerHTML = ''; return; }
    pagination.innerHTML = `
        <div class="health-pagination">
            <button class="health-page-btn" onclick="changeCertsPage(${certsPage - 1})" ${certsPage === 1 ? 'disabled' : ''}>←</button>
            <span class="health-page-info">${certsPage} / ${totalPages}</span>
            <button class="health-page-btn" onclick="changeCertsPage(${certsPage + 1})" ${certsPage === totalPages ? 'disabled' : ''}>→</button>
        </div>`;
}

function changeCertsPage(p) {
    const totalPages = Math.ceil(certsData.length / CERTS_PER_PAGE);
    certsPage = Math.max(1, Math.min(p, totalPages));
    renderCertificatesPage();
}

async function loadCertificates() {
    const grid = document.getElementById('certificatesGrid');
    if (!grid) return;
    try {
        const res = await fetch('/api/certificates/me');
        const data = await res.json();
        certsData = (data.success && data.data.certificates.length)
            ? data.data.certificates
            : [];
        certsPage = 1;
        if (!certsData.length) {
            grid.innerHTML = '<p class="text-muted certificate-grid-empty">No certificates yet. Complete or leave a project to earn one.</p>';
            return;
        }
        renderCertificatesPage();
    } catch (e) {
        console.error('loadCertificates error:', e);
        grid.innerHTML = '<p class="text-muted certificate-grid-empty">Could not load certificates.</p>';
    }
}

// Show dev tools panel only for adminAta (checked against loaded user, not hostname)
function initDevTools() {
    const card = document.getElementById('devToolsCard');
    if (!card) return;
    if (currentUser && currentUser.username === 'adminAta') {
        card.style.display = '';
    }
}

async function devResetMock() {
    const btn = document.getElementById('resetMockBtn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    try {
        const res = await fetch('/api/certificates/dev/reset-mock', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Mock data reset complete', 'success');
            await loadCertificates();
        } else {
            showToast(data.message || 'Reset failed', 'error');
        }
    } catch (e) {
        showToast('Reset request failed', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Reset Mock Data';
}

async function devSeedMock() {
    const btn = document.getElementById('seedMockBtn');
    btn.disabled = true;
    btn.textContent = 'Seeding...';
    try {
        const res = await fetch('/api/certificates/dev/seed-mock', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Mock data seeded', 'success');
        } else {
            showToast(data.message || 'Seed failed', 'error');
        }
    } catch (e) {
        showToast('Seed request failed', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Seed Mock Data';
}

// Init
(async function initProfile() {
    checkGithubCallback();
    await Promise.all([loadUserProfile(), loadGithubStatus(), loadCertificates()]);
    initDevTools();
    showMainContent();
})();
