// ============================================================
// Clipnic Campaign Scraper — Main UI Logic
// ============================================================

// ---- State ----
let currentJobId = null;
let pollTimer = null;
let logTimer = null;
let adminCurrentPage = 1;

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
    const rawUsernames = document.getElementById('input-username').value.trim();
    const afterDate = document.getElementById('input-date').value;
    const cpmRate = parseFloat(document.getElementById('input-cpm').value) || 4;

    if (!rawUsernames) { showToast('Enter at least one TikTok username', 'error'); return; }
    if (!afterDate) { showToast('Select a date', 'error'); return; }

    // Parse usernames (split by comma, space, or newline)
    const usernames = rawUsernames
        .split(/[\s,]+/)
        .map(u => u.trim().replace(/^@/, ''))
        .filter(Boolean);

    if (usernames.length === 0) return;

    const btn = document.getElementById('btn-scrape');
    btn.classList.add('loading');
    btn.disabled = true;

    // Show status panel
    const statusEl = document.getElementById('job-status');
    statusEl.classList.remove('hidden');

    // Process queue sequentially
    for (let i = 0; i < usernames.length; i++) {
        const username = usernames[i];
        document.getElementById('status-title').textContent = `Queuing @${username}... (${i + 1}/${usernames.length})`;
        document.getElementById('status-detail').textContent = 'Connecting to Apify...';
        document.getElementById('status-spinner').classList.remove('hidden');

        try {
            const result = await API.startScrape(username, afterDate, cpmRate);
            currentJobId = result.jobId;
            showToast(`Started @${username} (Job #${result.jobId})`, 'success');

            // Wait for this job to complete before starting next
            await waitForJobCompletion(result.jobId);
        } catch (err) {
            showToast(`Error starting @${username}: ${err.message}`, 'error');
            // Wait a few seconds before trying the next one if it failed immediately
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    // Done with all
    document.getElementById('status-title').textContent = `Bulk Scrape Complete!`;
    document.getElementById('status-detail').textContent = `Processed ${usernames.length} profiles.`;
    document.getElementById('status-spinner').classList.add('hidden');
    
    btn.classList.remove('loading');
    btn.disabled = false;
}

// Promisified poller that blocks the async queue
function waitForJobCompletion(jobId) {
    return new Promise((resolve) => {
        let timer = setInterval(async () => {
            try {
                // Poll the new /sync endpoint which actively fetches from Apify
                const syncData = await API.syncJob(jobId);
                
                // Then get the updated status from DB to update UI
                const data = await API.getJobStatus(jobId);
                updateStatusUI(data);

                if (['completed', 'failed'].includes(data.job.status)) {
                    clearInterval(timer);
                    loadPastJobs();
                    resolve();
                }
            } catch (err) {
                console.error('Poll error:', err);
                // Don't resolve on temporary poll error, let it retry
            }
        }, 3000);
    });
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
        document.getElementById('status-spinner').classList.add('hidden');
        detail.textContent = metrics
            ? `${fmtNum(metrics.total_views)} total views · ${fmtNum(metrics.eligible_views)} eligible · $${metrics.gross_profit.toFixed(2)} gross profit`
            : 'Completed';
        showToast(`Scrape complete! ${job.totalVideos} videos from @${job.username}`, 'success');
    } else if (job.status === 'failed') {
        document.getElementById('status-spinner').classList.add('hidden');
        detail.textContent = job.errorMessage || 'An error occurred';
        showToast(`Scrape failed for @${job.username}`, 'error');
    } else {
        document.getElementById('status-spinner').classList.remove('hidden');
        detail.textContent = `Status: ${job.status}`;
    }
}

async function loadPastJobs() {
    try {
        const data = await API.getJobs();
        const list = document.getElementById('jobs-list');

        if (data.jobs.length === 0) {
            list.innerHTML = '<div class="empty-state" style="padding:30px 10px"><p>No scrape jobs yet. Start your first scrape above!</p></div>';
            return;
        }

        let hasActiveJobs = false;

        list.innerHTML = data.jobs.map(job => {
            let progressText = `${job.total_videos || 0} videos`;
            if (job.status === 'scraping' || job.status === 'processing') {
                 hasActiveJobs = true;
                 progressText = `<span style="color:var(--text-main); font-weight:500;">${job.total_videos || 0} videos found so far...</span>`;
                 
                 // Trigger background sync to keep Vercel active if we just opened the page
                 API.syncJob(job.id).catch(e => console.error('Background sync failed:', e));
            }

            return `
            <div class="job-card" style="cursor:pointer" onclick="viewJob(${job.id})">
                <div class="job-info">
                    <h4>@${job.username}</h4>
                    <p>After ${fmtDate(job.after_date)} &middot; ${progressText} &middot; $${job.cpm_rate} CPM &middot; ${fmtDateTime(job.created_at)}</p>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <span class="badge badge-${job.status}">${job.status}</span>
                    <button class="btn btn-outline" style="padding:6px; border-color:var(--border-color); color:var(--text-muted);" onclick="deleteJob(event, ${job.id})" title="Delete Job">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
            `;
        }).join('');
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

async function deleteJob(e, jobId) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to permanently delete this job and all its videos? This cannot be undone.')) return;
    
    try {
        await API.deleteJob(jobId);
        showToast('Job deleted successfully', 'success');
        
        // If the admin tab was viewing this job, reset it
        const adminSelect = document.getElementById('admin-job-select');
        if (adminSelect && parseInt(adminSelect.value) === jobId) {
            adminSelect.value = "";
            loadJobForReview();
        }
        
        loadPastJobs();
        loadAdminJobList();
    } catch (err) {
        showToast(`Failed to delete: ${err.message}`, 'error');
    }
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

function exportGlobalCSV() {
    window.open('/api/export/approved-csv', '_blank');
    showToast('Downloading Global CSV Export...', 'info');
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

// Auto-refresh logs and past jobs
function startAutoRefresh() {
    if (logTimer) clearInterval(logTimer);
    logTimer = setInterval(() => {
        const logsTab = document.getElementById('content-logs');
        if (logsTab && logsTab.classList.contains('active')) {
            refreshLogs();
        }
        
        const scraperTab = document.getElementById('content-scraper');
        if (scraperTab && scraperTab.classList.contains('active')) {
            loadPastJobs();
        }
    }, 4000); // 4 seconds
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
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

    // Set default date to 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    document.getElementById('input-date').value = thirtyDaysAgo.toISOString().split('T')[0];

    loadPastJobs();
    startAutoRefresh();
});
