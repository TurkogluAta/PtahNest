// Common navbar functionality for all pages

// ========================================
// TOAST NOTIFICATION SYSTEM
// ========================================

// Create toast container and add to DOM
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

// Show a toast notification
// type: 'success' | 'error' | 'info' (default: 'info')
// duration: ms (default: 4000)
function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Trigger enter animation
    requestAnimationFrame(() => {
        toast.classList.add('toast-visible');
    });

    // Close on click
    toast.addEventListener('click', () => dismissToast(toast));

    // Auto dismiss
    const timer = setTimeout(() => dismissToast(toast), duration);
    toast._timer = timer;
}

// Dismiss a toast with exit animation
function dismissToast(toast) {
    if (toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._timer);
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    toast.addEventListener('transitionend', () => toast.remove());
}

// Reveal main content after data is ready
function showMainContent() {
    const main = document.querySelector('.main-content');
    if (main) main.classList.add('loaded');
}

// Authentication guard - checks if user is logged in
// If not authenticated, redirects to login page (unless on discover page)
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            // Check if we're on discover page - if so, allow access
            const isDiscoverPage = window.location.pathname.includes('discover.html');

            if (isDiscoverPage) {
                // User not logged in, but on discover page - that's okay
                // Hide user avatar and show login button in nav
                hideUserControls();
                showMainContent();
                return null;
            }

            // Not authenticated and not on discover page - redirect to login
            window.location.href = '/pages/auth.html';
            return null;
        }

        const data = await response.json();
        showUserControls();
        return data.user;
    } catch (error) {
        console.error('Auth check error:', error);

        // Check if we're on discover page
        const isDiscoverPage = window.location.pathname.includes('discover.html');
        if (isDiscoverPage) {
            hideUserControls();
            showMainContent();
            return null;
        }

        // On error, redirect to login for safety
        window.location.href = '/pages/auth.html';
        return null;
    }
}

// Show user controls (avatar, dropdown, notification bell) and hide login button
function showUserControls() {
    const userWrapper = document.querySelector('.user-wrapper');
    const loginBtn = document.getElementById('loginBtn');
    const notifWrapper = document.getElementById('notifWrapper');
    const headerIcons = document.querySelector('.header-icons');

    if (userWrapper) userWrapper.style.display = 'flex';
    if (loginBtn) loginBtn.style.display = 'none';
    if (notifWrapper) notifWrapper.style.display = 'flex';
    if (headerIcons) headerIcons.classList.add('loaded');

    // Show Dashboard and Projects links when logged in
    const mainNav = document.getElementById('mainNav');
    if (mainNav) {
        const navLinks = mainNav.querySelectorAll('a[href="index.html"], a[href="projects.html"]');
        navLinks.forEach(link => link.style.display = '');
        mainNav.classList.add('loaded');
    }

    // Show mobile menu Dashboard and Projects links
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu) {
        const mobileLinks = mobileMenu.querySelectorAll('a[href="index.html"], a[href="projects.html"]');
        mobileLinks.forEach(link => link.style.display = '');
    }

    // Fetch join requests for notification bell
    fetchNotifRequests();
}

// Hide user controls and show login button
function hideUserControls() {
    const userWrapper = document.querySelector('.user-wrapper');
    const loginBtn = document.getElementById('loginBtn');
    const notifWrapper = document.getElementById('notifWrapper');
    const headerIcons = document.querySelector('.header-icons');

    if (userWrapper) userWrapper.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'block';
    if (notifWrapper) notifWrapper.style.display = 'none';
    if (headerIcons) headerIcons.classList.add('loaded');

    // Hide Dashboard and Projects links when not logged in
    const mainNav = document.getElementById('mainNav');
    if (mainNav) {
        const navLinks = mainNav.querySelectorAll('a[href="index.html"], a[href="projects.html"]');
        navLinks.forEach(link => link.style.display = 'none');
        mainNav.classList.add('loaded');
    }

    // Hide mobile menu Dashboard and Projects links
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu) {
        const mobileLinks = mobileMenu.querySelectorAll('a[href="index.html"], a[href="projects.html"]');
        mobileLinks.forEach(link => link.style.display = 'none');
    }
}

// User avatar dropdown toggle
const userAvatar = document.getElementById("userAvatar");
const userDropdown = document.getElementById("userDropdown");

if (userAvatar && userDropdown) {
    userAvatar.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close notif panel if open
        if (notifPanel) notifPanel.classList.remove('open');
        userDropdown.style.display = userDropdown.style.display === "block" ? "none" : "block";
    });
}

// Close user dropdown when clicking outside
document.addEventListener('click', () => {
    if (userDropdown) userDropdown.style.display = 'none';
});

// Mobile hamburger menu toggle
const hamburgerBtn = document.getElementById("hamburgerBtn");
const mobileMenu = document.getElementById("mobileMenu");

if (hamburgerBtn && mobileMenu) {
    hamburgerBtn.addEventListener("click", () => {
        mobileMenu.style.display = mobileMenu.style.display === "flex" ? "none" : "flex";
    });
}

// Logout functionality
document.querySelectorAll('.dropdown-item').forEach(item => {
    if (item.textContent.trim() === 'Logout') {
        item.addEventListener('click', async (e) => {
            e.preventDefault();

            try {
                const response = await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.ok) {
                    window.location.href = '/pages/auth.html';
                } else {
                    console.error('Logout failed');
                }
            } catch (error) {
                console.error('Logout error:', error);
            }
        });
    }
});

// ========================================
// NOTIFICATION BELL — JOIN REQUESTS
// ========================================
let notifRequests = [];

// Toggle notification panel
const notifBell = document.getElementById('notifBell');
const notifPanel = document.getElementById('notifPanel');

if (notifBell && notifPanel) {
    notifBell.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close user dropdown if open
        if (userDropdown) userDropdown.style.display = 'none';
        notifPanel.classList.toggle('open');
    });
}

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    if (notifPanel && !notifPanel.contains(e.target) && e.target !== notifBell) {
        notifPanel.classList.remove('open');
    }
});

// Fetch join requests for all user's creator projects
async function fetchNotifRequests() {
    try {
        // Get user's projects
        const res = await fetch('/api/projects', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok) return;

        const data = await res.json();
        const creatorProjects = (data.projects || []).filter(p => p.status === 'active' && p.role === 'creator');

        // Fetch requests for each creator project
        const promises = creatorProjects.map(async (project) => {
            try {
                const r = await fetch(`/api/projects/${project.id}/requests`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (r.ok) {
                    const d = await r.json();
                    return d.requests.map(req => ({
                        ...req,
                        projectName: project.name,
                        projectId: project.id
                    }));
                }
                return [];
            } catch { return []; }
        });

        const results = await Promise.all(promises);
        notifRequests = results.flat();
        updateNotifBadge();
        renderNotifPanel();
    } catch (error) {
        console.error('Fetch notification requests error:', error);
    }
}

// Update badge count
function updateNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (notifRequests.length > 0) {
        badge.textContent = notifRequests.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// Render notification panel content
function renderNotifPanel() {
    const body = document.getElementById('notifPanelBody');
    if (!body) return;

    if (notifRequests.length === 0) {
        body.innerHTML = '<div class="notif-empty">No pending requests</div>';
        return;
    }

    body.innerHTML = notifRequests.map(req => `
        <div class="notif-item" id="notif-${req.id}">
            <div class="notif-item-info">
                <div class="notif-item-user">${req.username}</div>
                <div class="notif-item-project">${req.projectName}</div>
                <div class="notif-item-time">${notifFormatDate(req.created_at)}</div>
            </div>
            <div class="notif-item-actions">
                <button class="notif-btn notif-btn-accept" onclick="notifAccept('${req.id}', '${req.projectId}')">Accept</button>
                <button class="notif-btn notif-btn-reject" onclick="notifReject('${req.id}', '${req.projectId}')">Reject</button>
            </div>
        </div>
    `).join('');
}

// Format date for notifications
function notifFormatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

// Accept request from notification panel
async function notifAccept(requestId, projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/requests/${requestId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept' })
        });

        const data = await response.json();

        if (response.ok) {
            let msg = 'Request accepted! User added to project.';
            let toastType = 'success';
            let toastDuration = 4000;
            if (data.githubInvite) {
                if (data.githubInvite.sent && data.githubInvite.autoAccepted) {
                    msg = 'Request accepted! User added to project and GitHub repo.';
                } else if (data.githubInvite.sent) {
                    msg = 'Request accepted! GitHub repo invite sent (pending).';
                } else {
                    msg = `Request accepted! GitHub invite failed: ${data.githubInvite.error}`;
                    toastType = 'info';
                    toastDuration = 6000;
                }
            }
            showToast(msg, toastType, toastDuration);
            notifRequests = notifRequests.filter(r => r.id !== requestId);
            updateNotifBadge();
            renderNotifPanel();
        } else {
            showToast(data.message || 'Failed to accept request', 'error');
        }
    } catch (error) {
        console.error('Accept request error:', error);
        showToast('Failed to accept request. Please try again.', 'error');
    }
}

// Reject request from notification panel
async function notifReject(requestId, projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/requests/${requestId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reject' })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Request rejected.', 'success');
            notifRequests = notifRequests.filter(r => r.id !== requestId);
            updateNotifBadge();
            renderNotifPanel();
        } else {
            showToast(data.message || 'Failed to reject request', 'error');
        }
    } catch (error) {
        console.error('Reject request error:', error);
        showToast('Failed to reject request. Please try again.', 'error');
    }
}

// Run auth check when page loads
checkAuth();
