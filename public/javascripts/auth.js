// Form switching via links only
const forms = document.querySelectorAll('.form');
const messageDiv = document.getElementById('message');
const formTitle = document.querySelector('.form-title');
const formSubtitle = document.querySelector('.form-subtitle');

function switchToTab(tab) {
    forms.forEach(f => f.classList.remove('active'));
    document.getElementById(`${tab}Form`).classList.add('active');

    // Update header text
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

// Password toggle
document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);

        if (input.type === 'password') {
            input.type = 'text';

            // Switch to eye-hide icon
            btn.innerHTML = `
                <img src="pictures/icons/eye-hide.svg" alt="hide password">
            `;
        } else {
            input.type = 'password';

            // Switch to eye icon
            btn.innerHTML = `
                <img src="pictures/icons/eye.svg" alt="show password">
            `;
        }
    });
});


// Show message
function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type} show`;
    setTimeout(() => messageDiv.classList.remove('show'), 4000);
}

// Login form
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showMessage('Please fill in all fields', 'error');
        return;
    }

    showMessage('Signing in...', 'success');
    console.log('Login:', { email, password });
});

// Register form
document.getElementById('registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const terms = document.getElementById('terms').checked;

    if (!name || !email || !password || !confirm) {
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

    showMessage('Account created successfully!', 'success');
    console.log('Register:', { name, email, password });
});