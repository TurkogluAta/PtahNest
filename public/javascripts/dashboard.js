// Authentication guard - checks if user is logged in
// If not authenticated, redirects to login page
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            // Not authenticated - redirect to login
            window.location.href = '/pages/auth.html';
            return null;
        }

        const data = await response.json();
        return data.user;
    } catch (error) {
        console.error('Auth check error:', error);
        // On error, redirect to login for safety
        window.location.href = '/pages/auth.html';
        return null;
    }
}

// Run auth check immediately when script loads
checkAuth();

// User avatar dropdown toggle
const userAvatar = document.getElementById("userAvatar");
const userDropdown = document.getElementById("userDropdown");

userAvatar.addEventListener("click", () => {
    userDropdown.style.display =
        userDropdown.style.display === "block" ? "none" : "block";
});

// Mobile hamburger menu toggle
const hamburgerBtn = document.getElementById("hamburgerBtn");
const mobileMenu = document.getElementById("mobileMenu");

hamburgerBtn.addEventListener("click", () => {
    mobileMenu.style.display =
        mobileMenu.style.display === "flex" ? "none" : "flex";
});

// Logout functionality
document.querySelectorAll('.dropdown-item').forEach(item => {
    if (item.textContent.trim() === 'Logout') {
        item.addEventListener('click', async (e) => {
            e.preventDefault();

            try {
                const response = await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (response.ok) {
                    window.location.href = '/pages/auth.html';
                } else {
                    console.error('Logout failed:', data.message);
                    alert('Logout failed. Please try again.');
                }
            } catch (error) {
                console.error('Logout error:', error);
                alert('Network error. Please try again.');
            }
        });
    }
});
