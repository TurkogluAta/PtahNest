const TRIGGER_LABELS = {
    completed: 'PROJECT COMPLETED',
    left: 'LEFT PROJECT',
    kicked: 'KICKED',
    deleted: 'PROJECT ENDED'
};

async function verify() {
    // Support both /verify/:id and ?id= formats
    const id = window.location.pathname.split('/').pop() || new URLSearchParams(window.location.search).get('id');
    const card = document.getElementById('verifyCard');

    if (!id) {
        card.innerHTML = `<div class="verify-icon">❌</div><div class="verify-title">Invalid Link</div><div class="verify-sub">No certificate ID provided.</div>`;
        return;
    }

    try {
        const res = await fetch(`/api/certificates/verify/${id}`);
        const data = await res.json();

        if (!data.success) {
            card.innerHTML = `<div class="verify-icon">❌</div><div class="verify-title">Not Found</div><div class="verify-sub">This certificate does not exist or has been removed.</div>`;
            return;
        }

        const c = data.data.certificate;
        const label = TRIGGER_LABELS[c.trigger_type] || c.trigger_type;
        const date = new Date(c.issued_at).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

        card.innerHTML = `
            <div class="verify-icon">✅</div>
            <div class="verify-title">Certificate Verified</div>
            <div class="verify-sub">This certificate was issued by PtahNest and is authentic.</div>
            <div>
                <div class="verify-row"><span class="verify-label">Recipient</span><span class="verify-value">@${c.username}</span></div>
                <div class="verify-row"><span class="verify-label">Project</span><span class="verify-value">${c.project_name}</span></div>
                <div class="verify-row"><span class="verify-label">Status</span><span class="verify-badge cert-trigger-${c.trigger_type}">${label}</span></div>
                <div class="verify-row"><span class="verify-label">Issued</span><span class="verify-value">${date}</span></div>
                ${c.was_creator ? `<div class="verify-row"><span class="verify-label">Role</span><span class="verify-value verify-creator-value">★ Project Creator</span></div>` : ''}
                ${c.commit_count > 0 ? `<div class="verify-row"><span class="verify-label">Commits</span><span class="verify-value">${c.commit_count}</span></div>` : ''}
                ${c.avg_rating != null ? `<div class="verify-row"><span class="verify-label">Avg Rating</span><span class="verify-value">★ ${parseFloat(c.avg_rating).toFixed(1)} / 5</span></div>` : ''}
            </div>
            <div class="verify-footer"><a href="https://ptahnest.me">ptahnest.me</a></div>
        `;
    } catch (e) {
        card.innerHTML = `<div class="verify-icon">❌</div><div class="verify-title">Error</div><div class="verify-sub">Could not verify certificate.</div>`;
    }
}

verify();
