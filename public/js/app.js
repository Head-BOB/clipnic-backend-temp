// ============================================================
// Clipnic Campaign Scraper — Main UI Logic
// ============================================================

// ---- State ----
let currentJobId = null;
let pollTimer = null;
let logTimer = null;
let adminCurrentPage = 1;

// ---- Tab Navigation ----
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('content-' + tab.dataset.tab).classList.add('active');

        // Close sidebar on mobile after click
        document.getElementById('sidebar').classList.remove('open');

        if (tab.dataset.tab === 'admin') loadAdminJobList();
        if (tab.dataset.tab === 'logs') refreshLogs();
        if (tab.dataset.tab === 'scraper') loadPastJobs();
    });
});

// ---- Mobile Menu ----
const mobileToggle = document.getElementById('mobile-menu-toggle');
if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });
}

// ---- Toast ----
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ---- Number Formatting ----
function fmtNum(n) {
    if (n === null || n === undefined) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// SCRAPER TAB
// ============================================================

async function startScrape() {
    const username = document.getElementById('input-username').value.trim();
    const afterDate = document.getElementById('input-date').value;
    const cpmRate = parseFloat(document.getElementById('input-cpm').value) || 4;

    if (!username) { showToast('Enter a TikTok username', 'error'); return; }
    if (!afterDate) { showToast('Select a date', 'error'); return; }

    const btn = document.getElementById('btn-scrape');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const result = await API.startScrape(username, afterDate, cpmRate);
        currentJobId = result.jobId;
        showToast(`Scrape started for @${username} (Job #${result.jobId})`, 'success');

        // Show status panel
        const statusEl = document.getElementById('job-status');
        statusEl.classList.remove('hidden');
        document.getElementById('status-title').textContent = `Scraping @${username}...`;
        document.getElementById('status-detail').textContent = 'Connecting to Apify...';
        document.getElementById('status-indicator').className = 'status-indicator';
        document.getElementById('progress-bar').className = 'progress-bar';

        // Start polling
        startPolling(result.jobId);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function startPolling(jobId) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const data = await API.getJobStatus(jobId);
            updateStatusUI(data);

            if (['completed', 'failed'].includes(data.job.status)) {
                clearInterval(pollTimer);
                pollTimer = null;
                loadPastJobs();
            }
        } catch (err) {
            console.error('Poll error:', err);
        }
    }, 3000);
}

function updateStatusUI(data) {
    const { job, metrics } = data;
    const indicator = document.getElementById('status-indicator');
    const title = document.getElementById('status-title');
    const detail = document.getElementById('status-detail');
    const progressBar = document.getElementById('progress-bar');

    const statusMap = {
        pending: 'Queued...',
        scraping: `Scraping @${job.username}... (${job.totalVideos || 0} videos found so far)`,
        processing: `Saving to database... (${job.totalVideos || 0} videos)`,
        completed: `Done! ${job.totalVideos} videos stored.`,
        failed: `Failed: ${job.errorMessage || 'Unknown error'}`
    };

    title.textContent = statusMap[job.status] || job.status;

    if (job.status === 'completed') {
        indicator.className = 'status-indicator done';
        progressBar.className = 'progress-bar done';
        detail.textContent = metrics
            ? `${fmtNum(metrics.total_views)} total views · ${fmtNum(metrics.eligible_views)} eligible · $${metrics.gross_profit.toFixed(2)} gross profit`
            : 'Completed';
        showToast(`Scrape complete! ${job.totalVideos} videos from @${job.username}`, 'success');
    } else if (job.status === 'failed') {
        indicator.className = 'status-indicator error';
        progressBar.style.display = 'none';
        detail.textContent = job.errorMessage || 'An error occurred';
        showToast(`Scrape failed for @${job.username}`, 'error');
    } else {
        detail.textContent = `Status: ${job.status}`;
    }
}

async function loadPastJobs() {
    try {
        const data = await API.getJobs();
        const list = document.getElementById('jobs-list');

        if (data.jobs.length === 0) {
            list.innerHTML = '<p class="text-muted" style="padding:20px;text-align:center">No scrape jobs yet. Start your first scrape above!</p>';
            return;
        }

        list.innerHTML = data.jobs.map(job => `
            <div class="job-card" onclick="viewJob(${job.id})">
                <div class="job-card-info">
                    <strong>@${job.username}</strong>
                    <span>After ${fmtDate(job.after_date)} · ${job.total_videos || 0} videos · $${job.cpm_rate} CPM</span>
                    <span>${fmtDateTime(job.created_at)}</span>
                </div>
                <span class="job-status-badge badge-${job.status}">${job.status}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('Load jobs error:', err);
    }
}

function viewJob(jobId) {
    // Switch to admin tab and load this job
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-admin').classList.add('active');
    document.getElementById('content-admin').classList.add('active');

    loadAdminJobList().then(() => {
        document.getElementById('admin-job-select').value = jobId;
        loadJobForReview();
    });
}

// ============================================================
// ADMIN REVIEW TAB
// ============================================================

async function loadAdminJobList() {
    try {
        const data = await API.getJobs();
        const select = document.getElementById('admin-job-select');
        const currentVal = select.value;

        select.innerHTML = '<option value="">— Select a job —</option>';
        data.jobs.filter(j => j.status === 'completed').forEach(job => {
            const opt = document.createElement('option');
            opt.value = job.id;
            opt.textContent = `@${job.username} — ${job.total_videos} videos — ${fmtDate(job.after_date)} — $${job.cpm_rate} CPM`;
            select.appendChild(opt);
        });

        if (currentVal) select.value = currentVal;
    } catch (err) {
        console.error('Load admin jobs error:', err);
    }
}

async function loadJobForReview() {
    const jobId = parseInt(document.getElementById('admin-job-select').value);
    if (!jobId) {
        document.getElementById('metrics-grid').classList.add('hidden');
        document.getElementById('video-list-container').classList.add('hidden');
        document.getElementById('btn-export-pdf').disabled = true;
        return;
    }

    adminCurrentPage = 1;
    await loadMetrics(jobId);
    await loadVideoPage(jobId);

    document.getElementById('btn-export-pdf').disabled = false;
}

async function loadMetrics(jobId) {
    try {
        const data = await API.getJobSummary(jobId);
        const m = data.metrics;
        const grid = document.getElementById('metrics-grid');
        grid.classList.remove('hidden');

        document.getElementById('mv-total-views').textContent = fmtNum(m.total_views);
        document.getElementById('mv-eligible-views').textContent = fmtNum(m.eligible_views);
        document.getElementById('mv-profit').textContent = `$${m.gross_profit.toFixed(2)}`;
        document.getElementById('mv-approved-profit').textContent = `$${m.approved_profit.toFixed(2)}`;
        document.getElementById('header-approved-count').textContent = m.approved_count || 0;
    } catch (err) {
        showToast('Failed to load metrics', 'error');
    }
}

async function loadVideoPage(jobId, page) {
    if (page) adminCurrentPage = page;
    const filter = document.getElementById('admin-filter').value;

    try {
        const data = await API.getVideos(jobId, adminCurrentPage, 50, filter);
        const container = document.getElementById('video-list-container');
        container.classList.remove('hidden');

        document.getElementById('video-count-label').textContent =
            `${data.total} videos (page ${data.page}/${data.totalPages})`;

        renderVideoList(data.videos, jobId);
        renderPagination(data, jobId);
    } catch (err) {
        showToast('Failed to load videos', 'error');
    }
}

function renderVideoList(videos, jobId) {
    const list = document.getElementById('video-list');

    if (videos.length === 0) {
        list.innerHTML = '';
        document.getElementById('video-empty-state').classList.remove('hidden');
        document.getElementById('video-list-wrapper').classList.add('hidden');
        return;
    }

    document.getElementById('video-empty-state').classList.add('hidden');
    document.getElementById('video-list-wrapper').classList.remove('hidden');

    list.innerHTML = videos.map(v => {
        const thumbHtml = v.cover_url
            ? `<img src="${v.cover_url}" class="video-thumb" alt="Video thumbnail" loading="lazy" onerror="this.outerHTML='<div class=\\'video-thumb-placeholder\\'><svg width=\\'20\\' height=\\'20\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><polygon points=\\'5 3 19 12 5 21 5 3\\'/></svg></div>'">`
            : `<div class="video-thumb-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`;

        const desc = v.description || 'No description';
        const truncatedDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;

        const profitHtml = v.is_eligible
            ? `<span class="video-profit text-green">$${v.profit.toFixed(2)}</span>`
            : `<span class="video-profit ineligible">Ineligible</span>`;

        const statusBadge = v.review_status === 'approved'
            ? '<span class="badge badge-approved">Approved</span>'
            : v.review_status === 'rejected'
            ? '<span class="badge badge-rejected">Rejected</span>'
            : '<span class="badge badge-pending">Pending</span>';

        return `
            <div class="video-card" id="video-card-${v.id}">
                ${thumbHtml}
                <div class="video-info">
                    <div class="video-title" title="${desc.replace(/"/g, '&quot;')}">${truncatedDesc}</div>
                    <div class="video-meta">
                        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> ${fmtNum(v.play_count)}</span>
                        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> ${fmtNum(v.digg_count)}</span>
                        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="9" y1="21" x2="21" y2="3"/><line x1="21" y1="21" x2="3" y2="21"/></svg> ${fmtNum(v.share_count)}</span>
                        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> ${fmtNum(v.comment_count)}</span>
                        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${fmtDate(v.created_time_iso)}</span>
                    </div>
                </div>
                <div class="video-stats">
                    ${profitHtml}
                    ${statusBadge}
                </div>
                <div class="video-actions">
                    <button class="btn btn-success" onclick="reviewVideo(${v.id}, 'approved', ${jobId})" ${v.review_status === 'approved' ? 'disabled' : ''}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button class="btn btn-danger" onclick="reviewVideo(${v.id}, 'rejected', ${jobId})" ${v.review_status === 'rejected' ? 'disabled' : ''}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <a href="${v.web_video_url}" target="_blank" class="btn btn-outline" style="padding:6px 12px;font-size:12px">View</a>
                </div>
            </div>
        `;
    }).join('');
}

function renderPagination(data, jobId) {
    if (data.totalPages <= 1) {
        document.getElementById('pagination-top').innerHTML = '';
        document.getElementById('pagination-bottom').innerHTML = '';
        return;
    }

    const html = buildPaginationHTML(data, jobId);
    document.getElementById('pagination-top').innerHTML = html;
    document.getElementById('pagination-bottom').innerHTML = html;
}

function buildPaginationHTML(data, jobId) {
    let html = '';
    html += `<button ${data.page <= 1 ? 'disabled' : ''} onclick="loadVideoPage(${jobId}, ${data.page - 1})">← Prev</button>`;

    const maxButtons = 7;
    let start = Math.max(1, data.page - 3);
    let end = Math.min(data.totalPages, start + maxButtons - 1);
    if (end - start < maxButtons - 1) start = Math.max(1, end - maxButtons + 1);

    if (start > 1) html += `<button onclick="loadVideoPage(${jobId}, 1)">1</button><span style="color:var(--text-muted);padding:0 4px">…</span>`;

    for (let i = start; i <= end; i++) {
        html += `<button class="${i === data.page ? 'active' : ''}" onclick="loadVideoPage(${jobId}, ${i})">${i}</button>`;
    }

    if (end < data.totalPages) html += `<span style="color:var(--text-muted);padding:0 4px">…</span><button onclick="loadVideoPage(${jobId}, ${data.totalPages})">${data.totalPages}</button>`;

    html += `<button ${data.page >= data.totalPages ? 'disabled' : ''} onclick="loadVideoPage(${jobId}, ${data.page + 1})">Next →</button>`;
    return html;
}

async function reviewVideo(videoId, status, jobId) {
    try {
        await API.reviewVideo(videoId, status);
        showToast(`Video ${status}`, status === 'approved' ? 'success' : 'info');

        // Reload metrics and current page
        await loadMetrics(jobId);
        await loadVideoPage(jobId);
    } catch (err) {
        showToast(`Review failed: ${err.message}`, 'error');
    }
}

function exportPDF() {
    const jobId = parseInt(document.getElementById('admin-job-select').value);
    if (!jobId) return;
    window.open(API.getExportPdfUrl(jobId), '_blank');
    showToast('Generating PDF report...', 'info');
}

// ============================================================
// LOGS TAB
// ============================================================

async function refreshLogs() {
    const source = document.getElementById('log-source').value;
    const level = document.getElementById('log-level').value;
    const lines = parseInt(document.getElementById('log-lines').value);

    try {
        const data = await API.getLogs(source, level, lines);
        const output = document.getElementById('log-output');

        if (!data.logs || data.logs.length === 0) {
            output.innerHTML = '<span class="text-muted">No logs available yet.</span>';
            return;
        }

        output.innerHTML = data.logs.map(line => {
            let levelClass = '';
            if (line.includes('ERROR')) levelClass = 'log-level-error';
            else if (line.includes('WARN')) levelClass = 'log-level-warn';
            else if (line.includes('INFO')) levelClass = 'log-level-info';
            else if (line.includes('DEBUG')) levelClass = 'log-level-debug';

            const escaped = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // Highlight module tags
            const highlighted = escaped.replace(/\[([A-Z:_]+)\]/g, '<span class="log-module">[$1]</span>');
            return `<span class="log-line ${levelClass}">${highlighted}</span>`;
        }).join('\n');

        // Auto-scroll to bottom
        const viewer = document.getElementById('log-viewer');
        viewer.scrollTop = viewer.scrollHeight;
    } catch (err) {
        console.error('Log refresh error:', err);
    }
}

// Auto-refresh logs
function startLogAutoRefresh() {
    if (logTimer) clearInterval(logTimer);
    logTimer = setInterval(() => {
        const autoRefresh = document.getElementById('log-auto-refresh');
        const logsTab = document.getElementById('content-logs');
        if (autoRefresh.checked && logsTab.classList.contains('active')) {
            refreshLogs();
        }
    }, 5000);
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Set default date to 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    document.getElementById('input-date').value = thirtyDaysAgo.toISOString().split('T')[0];

    loadPastJobs();
    startLogAutoRefresh();
});
