// DOM elements
const forms = document.querySelectorAll('.form');
const messageDiv = document.getElementById('message');
const formTitle = document.querySelector('.form-title');
const formSubtitle = document.querySelector('.form-subtitle');

// Switch between login and register forms
function switchToTab(tab) {
    forms.forEach(f => f.classList.remove('active'));
    document.getElementById(`${tab}Form`).classList.add('active');

    // Update header text based on active form
    if (tab === 'register') {
        formTitle.textContent = 'Welcome to PtahNest';
        formSubtitle.textContent = 'Create your account to get started';
    } else {
        formTitle.textContent = 'Welcome Back';
        formSubtitle.textContent = 'Sign in to continue your journey';
    }

    messageDiv.classList.remove('show');
}

// Handle switch links in forms
document.querySelectorAll('.switch-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        switchToTab(link.dataset.switch);
    });
});

// Password visibility toggle
document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);

        if (input.type === 'password') {
            input.type = 'text';
            btn.innerHTML = `
                <img src="../pictures/icons/eye-hide.svg" alt="hide password">
            `;
        } else {
            input.type = 'password';
            btn.innerHTML = `
                <img src="../pictures/icons/eye.svg" alt="show password">
            `;
        }
    });
});

// Display feedback message to user
function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type} show`;
    setTimeout(() => messageDiv.classList.remove('show'), 4000);
}

// Login form submission
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value;
    const password = document.getElementById('loginPassword').value;
    const remember = document.getElementById('remember').checked;

    if (!identifier || !password) {
        showMessage('Please fill in all fields', 'error');
        return;
    }

    try {
        showMessage('Signing in...', 'info');

        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ identifier, password, remember })
        });

        // Read response as text first, then try to parse as JSON
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            data = { message: text || 'An error occurred' };
        }

        if (response.ok) {
            showMessage('Login successful! Redirecting...', 'success');
            setTimeout(() => window.location.href = '/pages/index.html', 1000);
        } else {
            console.error('Login failed:', response.status, data);
            showMessage(data.message || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showMessage('Network error: ' + error.message, 'error');
    }
});

// Register form submission
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const terms = document.getElementById('terms').checked;

    // Client-side validation
    if (!username || !email || !password || !confirm) {
        showMessage('Please fill in all fields', 'error');
        return;
    }

    if (password !== confirm) {
        showMessage('Passwords do not match', 'error');
        return;
    }

    if (password.length < 8) {
        showMessage('Password must be at least 8 characters', 'error');
        return;
    }

    if (!terms) {
        showMessage('Please accept the terms of service', 'error');
        return;
    }

    try {
        showMessage('Creating account...', 'info');

        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });

        // Read response as text first, then try to parse as JSON
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            data = { message: text || 'An error occurred' };
        }

        if (response.ok) {
            showMessage('Account created! Redirecting...', 'success');
            setTimeout(() => window.location.href = '/pages/index.html', 1000);
        } else {
            console.error('Register failed:', response.status, data);
            showMessage(data.message || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Register error:', error);
        showMessage('Network error: ' + error.message, 'error');
    }
});