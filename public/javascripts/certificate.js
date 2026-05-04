'use strict';

// ─── SVG helpers ─────────────────────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const c of children) e.appendChild(c);
    return e;
}

function txt(content, attrs = {}) {
    const e = el('text', attrs);
    e.textContent = content;
    return e;
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function polar(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx, cy, r, a1, a2) {
    const s = polar(cx, cy, r, a1), e = polar(cx, cy, r, a2);
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${e.x} ${e.y} Z`;
}

// ─── Design tokens ───────────────────────────────────────────────────────────

const C = {
    bg:      '#0d1117',
    card:    '#161b22',
    border:  '#21262d',
    accent:  '#667eea',
    gold:    '#e3b341',
    dim:     '#8b949e',
    main:    '#e6edf3',
    sub:     '#c9d1d9',
    green:   '#3fb950',
    red:     '#f85149',
};

const PIE_PALETTE = ['#667eea', '#3fb950', '#f85149', '#e3b341', '#58a6ff', '#bc8cff'];

const TRIGGER = {
    completed: { label: 'Project Completed', color: C.green },
    left:      { label: 'Left Project',       color: C.dim   },
    kicked:    { label: 'Kicked',             color: C.red   },
    deleted:   { label: 'Project Ended',      color: C.dim   },
};

// ─── Layout constants ────────────────────────────────────────────────────────

const W = 860, H = 546, P = 40;

// ─── Certificate render ───────────────────────────────────────────────────────

function renderCertificate(cert, certId) {
    const raw = cert.payload;
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    payload.wasCreator  = cert.was_creator;
    payload.triggerType = cert.trigger_type;
    payload.issuedAt    = cert.issued_at;
    payload.certId      = certId;

    const svg = el('svg', {
        width: W, height: H, viewBox: `0 0 ${W} ${H}`,
        xmlns: 'http://www.w3.org/2000/svg',
        style: 'display:block;max-width:100%;font-family:Sora,sans-serif;'
    });

    // Background + outer border
    svg.appendChild(el('rect', { width: W, height: H, fill: C.bg }));
    svg.appendChild(el('rect', { x: 1, y: 1, width: W-2, height: H-2, rx: 12, fill: 'none', stroke: C.border, 'stroke-width': 1 }));

    drawHeader(svg, payload);
    if (payload.projectType === 'research') {
        drawResearchThanks(svg);
    } else {
        drawTimeline(svg, payload.timeline || []);
        drawWeightLine(svg, payload.weightHistory || []);
        drawPie(svg, payload.monthlyEffortPie || [], payload.githubUsername);
    }
    drawVerifyUrl(svg, payload.certId, payload);

    const container = document.getElementById('certContainer');
    container.innerHTML = '';
    container.appendChild(svg);
}

// ─── Header ──────────────────────────────────────────────────────────────────

function drawHeader(svg, p) {
    const t = TRIGGER[p.triggerType] || { label: p.triggerType, color: C.dim };
    const dateStr = new Date(p.issuedAt).toLocaleDateString('en-IE', { day:'numeric', month:'short', year:'numeric' });

    // Header bg card
    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: 100, fill: C.card }));

    // Left accent bar
    svg.appendChild(el('rect', { x: 0, y: 0, width: 4, height: 100, fill: C.accent }));

    // Bottom border
    svg.appendChild(el('line', { x1: 0, y1: 100, x2: W, y2: 100, stroke: C.border, 'stroke-width': 1 }));

    // Project name — vertically centered in header
    svg.appendChild(txt(esc(p.projectName), {
        x: P + 8, y: 42, fill: C.main,
        'font-size': 18, 'font-weight': 700
    }));

    // Avg rating from timeline
    const ratedCommits = (p.timeline || []).filter(c => c.rating != null && c.rating > 0);
    const avgRating = ratedCommits.length
        ? (ratedCommits.reduce((s, c) => s + c.rating, 0) / ratedCommits.length)
        : null;

    // Creator star + avg rating inline after project name
    if (p.wasCreator || avgRating != null) {
        const nameW = Math.min(p.projectName.length * 10.5, 380);
        let starX = P + 8 + nameW + 12;
        const starAttrs = { 'font-size': 18, 'dominant-baseline': 'auto' };
        if (p.wasCreator) {
            svg.appendChild(txt('★', { x: starX, y: 42, fill: '#9b59b6', ...starAttrs }));
            starX += 26;
        }
        if (avgRating != null) {
            svg.appendChild(txt('★', { x: starX, y: 42, fill: C.gold, ...starAttrs }));
            svg.appendChild(txt(avgRating.toFixed(1), { x: starX + 20, y: 42, fill: C.gold, 'font-size': 14, 'font-weight': 600, 'dominant-baseline': 'auto' }));
        }
    }

    // Trigger badge below name
    svg.appendChild(txt(t.label.toUpperCase(), {
        x: P + 8, y: 66, fill: t.color,
        'font-size': 10, 'font-weight': 600, 'letter-spacing': '0.08em'
    }));

    // Right: @username
    svg.appendChild(txt(`@${esc(p.username)}`, {
        x: W - P, y: 42, fill: C.sub,
        'font-size': 13, 'font-weight': 600, 'text-anchor': 'end'
    }));

    // Right: date
    svg.appendChild(txt(dateStr, {
        x: W - P, y: 62, fill: C.dim,
        'font-size': 11, 'text-anchor': 'end'
    }));

    // Right: PtahNest watermark
    svg.appendChild(txt('PtahNest', {
        x: W - P, y: 82, fill: C.accent,
        'font-size': 10, 'font-weight': 600, 'text-anchor': 'end', opacity: 0.5
    }));
}

// ─── Research thank-you (no commit data) ─────────────────────────────────────

function drawResearchThanks(svg) {
    const CY = H / 2 + 20; // vertically centered in the body area below header
    svg.appendChild(txt('Thank you for your contribution', {
        x: W / 2, y: CY - 16, fill: C.sub,
        'font-size': 15, 'font-weight': 600, 'text-anchor': 'middle'
    }));
    svg.appendChild(txt('Your participation in this research project has been recognized and appreciated.', {
        x: W / 2, y: CY + 10, fill: C.dim,
        'font-size': 11, 'text-anchor': 'middle'
    }));
}

// ─── Timeline ────────────────────────────────────────────────────────────────

function drawTimeline(svg, timeline) {
    const Y = 196, LEFT = P + 30, RIGHT = W - P - 30;

    svg.appendChild(txt('COMMIT TIMELINE', {
        x: W / 2, y: 132, fill: C.dim, 'font-size': 10, 'letter-spacing': '0.1em',
        'text-anchor': 'middle'
    }));

    // Base line
    svg.appendChild(el('line', { x1: LEFT, y1: Y, x2: RIGHT, y2: Y, stroke: C.border, 'stroke-width': 1.5 }));

    if (!timeline.length) {
        svg.appendChild(txt('No commit data', { x: (LEFT+RIGHT)/2, y: Y+5, fill: C.dim, 'font-size': 12, 'text-anchor': 'middle' }));
        return;
    }

    const n = timeline.length;
    const step = n > 1 ? (RIGHT - LEFT) / (n - 1) : 0;

    timeline.forEach((c, i) => {
        const cx = n === 1 ? (LEFT + RIGHT) / 2 : LEFT + i * step;
        const hasRating = c.rating != null && c.rating > 0;

        // Dot
        svg.appendChild(el('circle', { cx, cy: Y, r: 5, fill: hasRating ? C.accent : C.border, stroke: C.bg, 'stroke-width': 2 }));

        // Stars above — centered on dot
        if (hasRating) {
            const stars = Math.round(c.rating);
            svg.appendChild(txt('★'.repeat(stars), {
                x: cx, y: Y - 16, fill: C.gold, 'font-size': 9,
                'text-anchor': 'middle', 'dominant-baseline': 'auto'
            }));
            svg.appendChild(txt(c.rating.toFixed(1), {
                x: cx, y: Y - 6, fill: C.dim, 'font-size': 7,
                'text-anchor': 'middle', 'dominant-baseline': 'auto'
            }));
        }

        // Date below (every commit if ≤8, else every 2nd)
        if (n <= 8 || i % 2 === 0) {
            const d = c.date ? new Date(c.date).toLocaleDateString('en-IE', { day:'numeric', month:'short' }) : '';
            svg.appendChild(txt(d, {
                x: cx, y: Y + 18, fill: C.dim, 'font-size': 8, 'text-anchor': 'middle'
            }));
        }
    });
}

// ─── Weight line chart ───────────────────────────────────────────────────────

function drawWeightLine(svg, history) {
    const X = P, Y = 250, CW = (W - P*2) / 2 - 12, CH = 256;
    const IX = X + 44, IY = Y + 28, IW = CW - 56, IH = CH - 48;

    // Card
    svg.appendChild(el('rect', { x: X, y: Y, width: CW, height: CH, rx: 8, fill: C.card, stroke: C.border, 'stroke-width': 1 }));
    svg.appendChild(txt('Weight Over Time', { x: X+12, y: Y+15, fill: C.dim, 'font-size': 10, 'letter-spacing': '0.06em' }));

    if (history.length < 2) {
        svg.appendChild(txt('Not enough data', { x: X+CW/2, y: Y+CH/2+4, fill: C.dim, 'font-size': 11, 'text-anchor': 'middle' }));
        return;
    }

    const maxW = Math.max(...history.map(h => h.weight), 1);

    // 3 y-axis labels
    [0, 0.5, 1].forEach(f => {
        const gy = IY + IH - f * IH;
        svg.appendChild(el('line', { x1: IX, y1: gy, x2: IX+IW, y2: gy, stroke: C.border, 'stroke-width': 1 }));
        svg.appendChild(txt(Math.round(f * maxW), { x: IX-4, y: gy+4, fill: C.dim, 'font-size': 8, 'text-anchor': 'end' }));
    });

    const pts = history.map((h, i) => {
        const px = IX + (i / (history.length - 1)) * IW;
        const py = IY + IH - (h.weight / maxW) * IH;
        return `${px},${py}`;
    });

    // Gradient fill
    const gid = 'wg';
    const defs = el('defs');
    const grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': C.accent, 'stop-opacity': 0.25 }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': C.accent, 'stop-opacity': 0 }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    const first = pts[0], last = pts[pts.length-1];
    const [lx] = last.split(',');
    svg.appendChild(el('polygon', {
        points: `${IX},${IY+IH} ${pts.join(' ')} ${lx},${IY+IH}`,
        fill: `url(#${gid})`
    }));
    svg.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', stroke: C.accent, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));

    // End dot
    const [ex, ey] = last.split(',');
    svg.appendChild(el('circle', { cx: ex, cy: ey, r: 3.5, fill: C.accent, stroke: C.bg, 'stroke-width': 1.5 }));
}

// ─── Pie chart ────────────────────────────────────────────────────────────────

function drawPie(svg, pie, myUsername) {
    const X = W/2 + 6, Y = 250, CW = (W - P*2) / 2 - 12, CH = 256;
    const R = 72, HOLE = R * 0.42;
    // Center donut+legend group within the card
    const LEGEND_W = 110; // approx legend block width
    const GAP = 24;       // gap between donut and legend
    const groupW = R * 2 + GAP + LEGEND_W;
    const groupLeft = X + (CW - groupW) / 2;
    const CX = groupLeft + R, CY = Y + CH/2 + 4;
    const LX = groupLeft + R * 2 + GAP;

    // Card
    svg.appendChild(el('rect', { x: X, y: Y, width: CW, height: CH, rx: 8, fill: C.card, stroke: C.border, 'stroke-width': 1 }));
    svg.appendChild(txt('Star Rating Share', { x: X+12, y: Y+15, fill: C.dim, 'font-size': 10, 'letter-spacing': '0.06em' }));

    if (!pie.length) {
        svg.appendChild(txt('No data', { x: X+CW/2, y: Y+CH/2+4, fill: C.dim, 'font-size': 11, 'text-anchor': 'middle' }));
        return;
    }

    const total = pie.reduce((s, e) => s + e.commits, 0);
    const myEntry = pie.find(e => e.githubUsername === myUsername);
    const myCommits = myEntry ? myEntry.commits : 0;
    const myPct = total > 0 ? myCommits / total : 0;

    // Two slices: me (accent) + rest (grey)
    const myAngle = myPct * 360;
    if (myAngle > 0 && myAngle < 360) {
        svg.appendChild(el('path', { d: arc(CX, CY, R, 0, myAngle), fill: C.accent, stroke: C.bg, 'stroke-width': 1.5 }));
        svg.appendChild(el('path', { d: arc(CX, CY, R, myAngle, 360), fill: '#21262d', stroke: C.bg, 'stroke-width': 1.5 }));
    } else {
        svg.appendChild(el('circle', { cx: CX, cy: CY, r: R, fill: myAngle >= 360 ? C.accent : '#21262d' }));
    }

    // Donut hole
    svg.appendChild(el('circle', { cx: CX, cy: CY, r: HOLE, fill: C.card }));

    // Center: my %
    svg.appendChild(txt(`${Math.round(myPct * 100)}%`, {
        x: CX, y: CY + 6, fill: C.main,
        'font-size': 15, 'font-weight': 700, 'text-anchor': 'middle'
    }));

    // Legend — two rows, vertically centered in card
    [
        { color: C.accent, label: `@${esc(myUsername)}`, pct: Math.round(myPct * 100) },
        { color: '#30363d', label: 'Others', pct: Math.round((1 - myPct) * 100) }
    ].forEach((row, i) => {
        const ly = Y + CH/2 - 4 + i * 30;
        svg.appendChild(el('rect', { x: LX, y: ly - 9, width: 9, height: 9, rx: 2, fill: row.color, stroke: C.border, 'stroke-width': 1 }));
        svg.appendChild(txt(row.label, { x: LX + 16, y: ly, fill: i === 0 ? C.sub : C.dim, 'font-size': 11, 'font-weight': i === 0 ? 600 : 400 }));
        svg.appendChild(txt(`${row.pct}%`, { x: LX + 16, y: ly + 14, fill: i === 0 ? C.accent : C.dim, 'font-size': 11, 'font-weight': i === 0 ? 700 : 400 }));
    });
}

// ─── Verify URL footer ────────────────────────────────────────────────────────

function drawVerifyUrl(svg, certId, payload) {
    if (!certId) return;
    const url = `https://ptahnest.me/verify/${certId}`;
    // Verify link — bottom left
    svg.appendChild(txt(`Verify: ${url}`, {
        x: P, y: 534, fill: C.dim,
        'font-size': 8, 'text-anchor': 'start', 'letter-spacing': '0.04em'
    }));

    // GitHub profile link — bottom right (software projects with a github username only)
    if (payload && payload.projectType === 'software' && payload.githubUsername) {
        const profileUrl = `https://github.com/${esc(payload.githubUsername)}`;
        const a = el('a', { href: profileUrl, target: '_blank' });
        a.appendChild(txt(`github.com/${esc(payload.githubUsername)}`, {
            x: W - P, y: 534, fill: C.accent,
            'font-size': 8, 'text-anchor': 'end', 'letter-spacing': '0.04em',
            'text-decoration': 'underline'
        }));
        svg.appendChild(a);
    }
}

// ─── PNG download ─────────────────────────────────────────────────────────────

function downloadAsPNG() {
    const svg = document.querySelector('#certContainer svg');
    if (!svg) return;
    const scale = 2;
    const svgStr = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = W * scale; canvas.height = H * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(b => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'ptahnest-certificate.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }, 'image/png');
    };
    img.src = url;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
    if (typeof showMainContent === 'function') showMainContent();
    else {
        const main = document.querySelector('.main-content');
        if (main) main.classList.add('loaded');
        const loader = document.getElementById('pageLoader');
        if (loader) loader.classList.add('hidden');
    }

    const certId = new URLSearchParams(window.location.search).get('id');
    if (!certId) {
        document.getElementById('certLoading').style.display = 'none';
        document.getElementById('certError').style.display = '';
        return;
    }

    try {
        const url = `/api/certificates/${certId}`;
        const res = await fetch(url);
        const data = await res.json();

        document.getElementById('certLoading').style.display = 'none';

        if (!data.success || !data.data?.certificate) {
            document.getElementById('certError').style.display = '';
            return;
        }

        const page = document.getElementById('certPage');
        if (page) page.style.display = 'block';
        renderCertificate(data.data.certificate, certId);
    } catch (e) {
        console.error('Certificate load error:', e);
        document.getElementById('certLoading').style.display = 'none';
        document.getElementById('certError').style.display = '';
    }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(init, 50));
