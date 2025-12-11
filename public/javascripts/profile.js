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

// Load profile on page load
loadUserProfile();

