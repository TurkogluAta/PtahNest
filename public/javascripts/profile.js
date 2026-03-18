// Load and display current user's profile data
async function loadUserProfile() {
    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (response.ok && data.user) {
            document.getElementById('userName').textContent = data.user.username;
            document.getElementById('userEmail').textContent = data.user.email;
        } else {
            document.getElementById('userName').textContent = 'Error loading username';
            document.getElementById('userEmail').textContent = 'Error loading email';
        }
    } catch (error) {
        console.error('Error loading user profile:', error);
        document.getElementById('userName').textContent = 'Error loading username';
        document.getElementById('userEmail').textContent = 'Error loading email';
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

    // Clean URL params without reload
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
    // Warn member-only users that commit history will be unavailable after unlink
    if (!confirm('Are you sure you want to unlink your GitHub account?\n\nIf you are a member of any software projects, you will lose access to commit history and GitHub features until you re-link.')) return;

    try {
        const response = await fetch('/api/github/unlink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();
        const messageEl = document.getElementById('githubMessage');
        messageEl.style.display = 'block';

        if (data.success) {
            messageEl.className = 'github-message github-message-success';
            messageEl.textContent = 'GitHub account unlinked.';
            loadGithubStatus();
        } else {
            // Show error (e.g. blocked because user is a software project creator)
            messageEl.className = 'github-message github-message-error';
            messageEl.textContent = data.message || 'Failed to unlink GitHub account.';
        }
    } catch (error) {
        console.error('Error unlinking GitHub:', error);
    }
}

// Init — load data, then reveal content
(async function initProfile() {
    checkGithubCallback();
    await Promise.all([loadUserProfile(), loadGithubStatus()]);
    showMainContent();
})();
