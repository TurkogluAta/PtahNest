// Common navbar functionality for all pages

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
            return null;
        }

        // On error, redirect to login for safety
        window.location.href = '/pages/auth.html';
        return null;
    }
}

// Show user controls (avatar, dropdown) and hide login button
function showUserControls() {
    const userWrapper = document.querySelector('.user-wrapper');
    const loginBtn = document.getElementById('loginBtn');

    if (userWrapper) userWrapper.style.display = 'flex';
    if (loginBtn) loginBtn.style.display = 'none';
}

// Hide user controls and show login button
function hideUserControls() {
    const userWrapper = document.querySelector('.user-wrapper');
    const loginBtn = document.getElementById('loginBtn');

    if (userWrapper) userWrapper.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'block';
}

// User avatar dropdown toggle
const userAvatar = document.getElementById("userAvatar");
const userDropdown = document.getElementById("userDropdown");

if (userAvatar && userDropdown) {
    userAvatar.addEventListener("click", () => {
        userDropdown.style.display = userDropdown.style.display === "block" ? "none" : "block";
    });
}

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

// Run auth check when page loads
checkAuth();
