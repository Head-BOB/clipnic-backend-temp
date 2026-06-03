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

async function startUrlScrape() {
    const urls = document.getElementById('input-urls').value;
    const cpm = document.getElementById('url-input-cpm').value;
    const btn = document.getElementById('btn-url-scrape');

    if (!urls) return showToast('Please enter URLs', 'error');

    btn.disabled = true;
    showToast('Starting multi-platform scraper...', 'info');

    document.getElementById('job-status').classList.remove('hidden');
    document.getElementById('status-spinner').classList.remove('hidden');
    document.getElementById('status-title').textContent = 'Submitting URLs...';
    document.getElementById('status-detail').textContent = 'Waiting for API...';

    try {
        const res = await API.startUrlScrape(urls, parseFloat(cpm));
        showToast(res.message, 'success');
        
        document.getElementById('input-urls').value = '';
        
        // Wait for ALL created jobs sequentially
        for (const jobId of res.jobsCreated) {
            document.getElementById('status-title').textContent = `Processing Job #${jobId}...`;
            await waitForJobCompletion(jobId);
        }

        document.getElementById('status-title').textContent = `All URL Jobs Complete!`;
        document.getElementById('status-detail').textContent = `Processed ${res.jobsCreated.length} parallel jobs.`;
        document.getElementById('status-spinner').classList.add('hidden');
        
    } catch (err) {
        showToast(err.message, 'error');
        document.getElementById('status-title').textContent = 'Error';
        document.getElementById('status-detail').textContent = err.message;
        document.getElementById('status-spinner').classList.add('hidden');
    } finally {
        btn.disabled = false;
        loadPastJobs(); // refresh the UI list
    }
}

async function startAccountScrape() {
    const urls = document.getElementById('input-accounts').value;
    const afterDate = document.getElementById('account-input-date').value;
    const minViews = document.getElementById('account-min-views').value;
    const cpm = document.getElementById('account-input-cpm').value;
    const btn = document.getElementById('btn-account-scrape');

    if (!urls) return showToast('Please enter account URLs', 'error');
    if (!afterDate) return showToast('Please select a Videos After date', 'error');

    // Strict validation to prevent video URLs
    const urlArray = urls.split(/[\n,]+/).map(u => u.trim()).filter(u => u.length > 5);
    for (const u of urlArray) {
        if (u.includes('/video/') || u.includes('/p/') || u.includes('/reel/') || u.includes('watch?v=') || u.includes('youtu.be/')) {
            alert(`Error: Video link detected!\n\n"${u}"\n\nPlease paste ONLY account/channel profile links here. Direct video links belong in the "Direct Video Links Only" box.`);
            return;
        }
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Scraping Accounts...';

    document.getElementById('job-status').classList.remove('hidden');
    document.getElementById('status-spinner').classList.remove('hidden');
    document.getElementById('status-title').textContent = 'Submitting Account URLs...';
    document.getElementById('status-detail').textContent = 'Waiting for API...';

    try {
        const res = await API.startAccountScrape(urls, parseFloat(cpm), afterDate, parseInt(minViews));
        showToast(res.message, 'success');
        document.getElementById('input-accounts').value = '';

        // Wait for ALL created jobs sequentially
        for (const jobId of res.jobsCreated) {
            document.getElementById('status-title').textContent = `Processing Job #${jobId}...`;
            await waitForJobCompletion(jobId);
        }

        document.getElementById('status-title').textContent = `All Account Jobs Complete!`;
        document.getElementById('status-detail').textContent = `Processed ${res.jobsCreated.length} parallel jobs.`;
        document.getElementById('status-spinner').classList.add('hidden');
        
    } catch (err) {
        showToast(err.message, 'error');
        document.getElementById('status-title').textContent = 'Error';
        document.getElementById('status-detail').textContent = err.message;
        document.getElementById('status-spinner').classList.add('hidden');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Scrape Accounts';
        loadPastJobs();
    }
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

async function exportPDF() {
    const jobId = parseInt(document.getElementById('admin-job-select').value);
    if (!jobId) return;

    // We can fetch the filter if we want, or just default to 'all'
    const qualFilter = document.getElementById('admin-filter').value;
    
    showToast('Generating PDF report...', 'info');

    try {
        const { job, metrics } = await API.getJobStatus(jobId);
        const { videos } = await API.getVideos(jobId, 1, 10000, 'all'); // Fetch all videos

        const campaignTitle = `Campaign Analysis: @${job.username}`;
        const logoUrl = 'https://clipnic.com/logo.webp'; // Fallback to live URL if local fails
        const cpmRate = job.cpmRate || 4.0;

        // Apply qualification filter based on our metrics (is_eligible, review_status)
        const targetSubs = videos.filter(sub => {
            const isQualified = sub.review_status === 'approved' && sub.is_eligible;
            if (qualFilter === 'approved' || qualFilter === 'eligible') return isQualified;
            if (qualFilter === 'rejected' || qualFilter === 'ineligible') return !isQualified;
            return true;
        });

        const totalViewsCount = targetSubs.reduce((acc, sub) => acc + Number(sub.play_count || 0), 0);
        const qCount = targetSubs.filter(sub => sub.review_status === 'approved' && sub.is_eligible).length;

        const totalSpentSum = targetSubs.reduce((acc, sub) => {
            const isQual = sub.review_status === 'approved' && sub.is_eligible;
            const subCost = isQual ? ((Number(sub.play_count || 0) / 1000) * cpmRate) : 0;
            return acc + subCost;
        }, 0);

        const rowsHtml = targetSubs.map((sub, idx) => {
            const isQual = sub.review_status === 'approved' && sub.is_eligible;
            const subCost = isQual ? ((Number(sub.play_count || 0) / 1000) * cpmRate) : 0;
            // Platform auto-detect for UI display
            const platform = sub.web_video_url.includes('instagram') ? 'INSTAGRAM' : 
                             sub.web_video_url.includes('youtube') ? 'YOUTUBE' : 'TIKTOK';
            
            return `
                <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px;">${idx + 1}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; text-transform: uppercase; font-weight: bold; color: #555;">${platform}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; word-break: break-all; font-family: monospace; color: #0066cc;">
                        <a href="${sub.web_video_url}" target="_blank" style="color: #0066cc; text-decoration: none; display: inline-block;">${sub.web_video_url}</a>
                    </td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; font-weight: bold; text-align: right;">${Number(sub.play_count || 0).toLocaleString()}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; font-weight: bold; text-align: right; color: #111;">$${subCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; text-align: right; font-weight: bold; color: ${isQual ? '#0066cc' : '#f43f5e'}; text-transform: uppercase; letter-spacing: 0.5px;">${isQual ? 'Qualified' : 'Non-Qualified'}</td>
                </tr>
            `;
        }).join('');

        const element = document.createElement('div');
        element.innerHTML = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #333; position: relative; background: #ffffff; min-height: 277mm; box-sizing: border-box;">
                
                <!-- Header -->
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1a1a1a; padding-bottom: 20px; margin-bottom: 30px; position: relative; z-index: 1;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 36px; height: 36px; background-color: #000000; border-radius: 10px; display: flex; align-items: center; justify-content: center; padding: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                            <div style="color: white; font-weight: bold; font-size: 10px;">CLIPNIC</div>
                        </div>
                        <div>
                            <div style="font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #000; line-height: 1;">CLIPNIC</div>
                            <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #666; font-weight: 700; margin-top: 3px;">Campaign Analysis Report</div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 12px; font-weight: 800; color: #000;">
                            <a href="https://clipnic.com" target="_blank" style="color: inherit; text-decoration: none;">clipnic.com</a>
                        </div>
                        <div style="font-size: 9px; color: #888; font-weight: 500; margin-top: 2px;">SECURE DIGITAL REPORT</div>
                    </div>
                </div>

                <!-- Metrics & Details -->
                <div style="position: relative; z-index: 1;">
                    <div style="font-size: 28px; font-weight: 800; margin-top: 20px; margin-bottom: 5px; color: #111;">${campaignTitle}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Report Type: ${qualFilter.toUpperCase()}</div>
                    <div style="font-size: 11px; color: #888; margin-top: 4px;">Generated on ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</div>

                    <div style="display: flex; gap: 15px; margin-top: 30px; margin-bottom: 40px; background: #f9f9f9; padding: 20px; border-radius: 12px; border: 1px solid #eee;">
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Report Entries</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #111;">${targetSubs.length}</p>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Aggregate Reach</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #111;">${totalViewsCount.toLocaleString()}</p>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Qualified Count</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #111;">${qCount}</p>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Total Budget Spent</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #10b981;">$${totalSpentSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                    </div>

                    <!-- TABLE WRAPPER WITH CENTERED WATERMARK -->
                    <div style="position: relative; width: 100%; min-height: 400px; padding-bottom: 60px;">
                        
                        <!-- Watermark overlay perfectly centered inside the table wrapper -->
                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-25deg); text-align: center; pointer-events: none; z-index: 0; opacity: 0.05; display: flex; flex-direction: column; align-items: center; justify-content: center; user-select: none;">
                            <div style="font-size: 68px; font-weight: 900; letter-spacing: 10px; color: #000; text-transform: uppercase; line-height: 1;">CLIPNIC</div>
                            <div style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #000; margin-top: 10px;">clipnic.com</div>
                        </div>

                        <!-- Table -->
                        <table style="width: 100%; border-collapse: collapse; position: relative; z-index: 1;">
                            <thead>
                                <tr>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: left; width: 5%;">#</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: left; width: 12%;">Platform</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: left; width: 40%;">URL</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: right; width: 13%;">Views</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: right; width: 15%;">Spent</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: right; width: 15%;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Footer -->
                <div style="position: absolute; bottom: 30px; left: 40px; right: 40px; border-top: 1px solid #eee; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #888; font-weight: 500; z-index: 1;">
                    <div>&copy; ${new Date().getFullYear()} Clipnic. All rights reserved.</div>
                    <div style="display: flex; gap: 15px;">
                        <span>Website: <a href="https://clipnic.com" target="_blank" style="color: #666; text-decoration: underline;">clipnic.com</a></span>
                        <span>Support: <a href="mailto:support@clipnic.com" style="color: #666; text-decoration: underline;">support@clipnic.com</a></span>
                    </div>
                </div>
            </div>
        `;

        const opt = {
            margin:       10,
            filename:     `${job.username}_${qualFilter}_report.pdf`,
            enableLinks:  true,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // Note: html2canvas natively strips link clickability. 
        // We ensure a target="_blank" and distinct styling exist, but a pure canvas-to-pdf output from html2pdf natively doesn't support active anchor bounding boxes.
        html2pdf().set(opt).from(element).save();

        showToast('PDF downloaded successfully!', 'success');
    } catch (err) {
        showToast(`PDF generation failed: ${err.message}`, 'error');
        console.error(err);
    }
}

function exportGlobalURLs() {
    window.open('/api/export/approved-csv', '_blank');
    showToast('Downloading Approved URLs...', 'info');
}

async function exportGlobalPDF() {
    showToast('Generating Global PDF report...', 'info');
    const btn = document.querySelector('#content-stats .btn-primary');
    if (btn) btn.disabled = true;

    try {
        const { metrics } = await API.getGlobalMetrics();
        const { videos } = await API.getGlobalApprovedVideos();

        const campaignTitle = `Global Platform Report`;
        
        const totalViewsCount = videos.reduce((acc, sub) => acc + Number(sub.play_count || 0), 0);
        const qCount = videos.length;
        
        const totalSpentSum = videos.reduce((acc, sub) => {
            const subCost = ((Number(sub.play_count || 0) / 1000) * (sub.cpm_rate || 4.0));
            return acc + subCost;
        }, 0);

        const rowsHtml = videos.map((sub, idx) => {
            const cpmRate = sub.cpm_rate || 4.0;
            const subCost = ((Number(sub.play_count || 0) / 1000) * cpmRate);
            const platform = sub.web_video_url.includes('instagram') ? 'INSTAGRAM' : 
                             sub.web_video_url.includes('youtube') ? 'YOUTUBE' : 'TIKTOK';
            
            return `
                <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px;">${idx + 1}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; text-transform: uppercase; font-weight: bold; color: #555;">${platform}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; word-break: break-all; font-family: monospace; color: #0066cc;">
                        <a href="${sub.web_video_url}" target="_blank" style="color: #0066cc; text-decoration: none; display: inline-block;">${sub.web_video_url}</a>
                    </td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; font-weight: bold; text-align: right;">${Number(sub.play_count || 0).toLocaleString()}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; font-weight: bold; text-align: right; color: #111;">$${subCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 11px; text-align: right; font-weight: bold; color: #0066cc; text-transform: uppercase; letter-spacing: 0.5px;">Qualified</td>
                </tr>
            `;
        }).join('');

        const element = document.createElement('div');
        element.innerHTML = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #333; position: relative; background: #ffffff; min-height: 277mm; box-sizing: border-box;">
                
                <!-- Header -->
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1a1a1a; padding-bottom: 20px; margin-bottom: 30px; position: relative; z-index: 1;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 36px; height: 36px; background-color: #000000; border-radius: 10px; display: flex; align-items: center; justify-content: center; padding: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                            <div style="color: white; font-weight: bold; font-size: 10px;">CLIPNIC</div>
                        </div>
                        <div>
                            <div style="font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #000; line-height: 1;">CLIPNIC</div>
                            <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #666; font-weight: 700; margin-top: 3px;">Global Platform Report</div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 12px; font-weight: 800; color: #000;">
                            <a href="https://clipnic.com" target="_blank" style="color: inherit; text-decoration: none;">clipnic.com</a>
                        </div>
                        <div style="font-size: 9px; color: #888; font-weight: 500; margin-top: 2px;">SECURE DIGITAL REPORT</div>
                    </div>
                </div>

                <!-- Metrics & Details -->
                <div style="position: relative; z-index: 1;">
                    <div style="font-size: 28px; font-weight: 800; margin-top: 20px; margin-bottom: 5px; color: #111;">${campaignTitle}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Report Type: ALL APPROVED VIDEOS</div>
                    <div style="font-size: 11px; color: #888; margin-top: 4px;">Generated on ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</div>

                    <div style="display: flex; gap: 15px; margin-top: 30px; margin-bottom: 40px; background: #f9f9f9; padding: 20px; border-radius: 12px; border: 1px solid #eee;">
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Report Entries</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #111;">${videos.length}</p>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Aggregate Reach</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #111;">${totalViewsCount.toLocaleString()}</p>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Qualified Count</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #111;">${qCount}</p>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 5px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Total Budget Spent</h4>
                            <p style="margin: 0; font-size: 15px; font-weight: bold; color: #10b981;">$${totalSpentSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                    </div>

                    <!-- TABLE WRAPPER WITH CENTERED WATERMARK -->
                    <div style="position: relative; width: 100%; min-height: 400px; padding-bottom: 60px;">
                        
                        <!-- Watermark overlay perfectly centered inside the table wrapper -->
                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-25deg); text-align: center; pointer-events: none; z-index: 0; opacity: 0.05; display: flex; flex-direction: column; align-items: center; justify-content: center; user-select: none;">
                            <div style="font-size: 68px; font-weight: 900; letter-spacing: 10px; color: #000; text-transform: uppercase; line-height: 1;">CLIPNIC</div>
                            <div style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #000; margin-top: 10px;">clipnic.com</div>
                        </div>

                        <!-- Table -->
                        <table style="width: 100%; border-collapse: collapse; position: relative; z-index: 1;">
                            <thead>
                                <tr>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: left; width: 5%;">#</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: left; width: 12%;">Platform</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: left; width: 40%;">URL</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: right; width: 13%;">Views</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: right; width: 15%;">Spent</th>
                                    <th style="background: #1a1a1a; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 12px; text-align: right; width: 15%;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Footer -->
                <div style="position: absolute; bottom: 30px; left: 40px; right: 40px; border-top: 1px solid #eee; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #888; font-weight: 500; z-index: 1;">
                    <div>&copy; ${new Date().getFullYear()} Clipnic. All rights reserved.</div>
                    <div style="display: flex; gap: 15px;">
                        <span>Website: <a href="https://clipnic.com" target="_blank" style="color: #666; text-decoration: underline;">clipnic.com</a></span>
                        <span>Support: <a href="mailto:support@clipnic.com" style="color: #666; text-decoration: underline;">support@clipnic.com</a></span>
                    </div>
                </div>
            </div>
        `;

        const opt = {
            margin:       10,
            filename:     `clipnic_global_report.pdf`,
            enableLinks:  true,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(element).save();
        showToast('Global PDF downloaded successfully!', 'success');
    } catch (err) {
        showToast(`PDF generation failed: ${err.message}`, 'error');
        console.error(err);
    } finally {
        if (btn) btn.disabled = false;
    }
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

        const statsTab = document.getElementById('content-stats');
        if (statsTab && statsTab.classList.contains('active')) {
            loadGlobalStats();
        }
    }, 4000); // 4 seconds
}

// ============================================================
// STATS TAB
// ============================================================

async function loadGlobalStats() {
    try {
        const data = await API.getGlobalMetrics();
        const m = data.metrics;
        document.getElementById('global-mv-videos').innerText = fmtNum(m.total_videos);
        document.getElementById('global-mv-views').innerText = fmtNum(m.total_views);
        document.getElementById('global-mv-approved').innerText = fmtNum(m.approved_count);
        document.getElementById('global-mv-gross').innerText = '$' + fmtNum(m.gross_profit);
        document.getElementById('global-mv-profit').innerText = '$' + fmtNum(m.approved_profit);
    } catch (err) {
        console.error('Failed to load global stats:', err);
    }
}

// ============================================================
// SYSTEM AUDIT TAB
// ============================================================

async function runSystemAudit() {
    showToast('Running System Audit...', 'info');
    document.getElementById('audit-fn-list').innerHTML = '<div class="empty-state"><p>Scanning...</p></div>';
    document.getElementById('audit-fp-list').innerHTML = '<div class="empty-state"><p>Scanning...</p></div>';
    document.getElementById('audit-dup-list').innerHTML = '<div class="empty-state"><p>Scanning...</p></div>';

    try {
        const data = await API.getAuditAnomalies();
        
        document.getElementById('audit-fn-count').innerText = data.falseNegatives.length;
        document.getElementById('audit-fp-count').innerText = data.falsePositives.length;
        document.getElementById('audit-dup-count').innerText = data.duplicates?.length || 0;

        renderAuditList(data.falseNegatives, 'audit-fn-list', 'approved');
        renderAuditList(data.falsePositives, 'audit-fp-list', 'rejected');
        renderAuditList(data.duplicates || [], 'audit-dup-list', 'delete');
        
        if(data.falseNegatives.length === 0 && data.falsePositives.length === 0 && (!data.duplicates || data.duplicates.length === 0)) {
            showToast('Audit clean! No review mistakes found.', 'success');
        } else {
            showToast(`Found anomalies: ${data.falseNegatives.length} FN, ${data.falsePositives.length} FP, ${data.duplicates?.length || 0} Duplicates.`, 'warning');
        }
    } catch (err) {
        showToast('Audit failed: ' + err.message, 'error');
    }
}

function renderAuditList(videos, containerId, fixAction) {
    const container = document.getElementById(containerId);
    if (videos.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Clean! No anomalies detected here.</p></div>';
        return;
    }

    container.innerHTML = videos.map(v => {
        const profit = v.is_eligible ? (Number(v.play_count) / 1000) * v.cpm_rate : 0;
        
        let btnClass = 'btn-outline';
        let btnLabel = 'Fix';
        let onClickAction = `auditReviewVideo(${v.id}, 'approved')`;

        if (fixAction === 'approved') {
            btnClass = 'btn-primary';
            btnLabel = 'Approve Now';
            onClickAction = `auditReviewVideo(${v.id}, 'approved')`;
        } else if (fixAction === 'rejected') {
            btnLabel = 'Reject Now';
            onClickAction = `auditReviewVideo(${v.id}, 'rejected')`;
        } else if (fixAction === 'delete') {
            btnClass = 'btn-outline';
            btnLabel = 'Delete Duplicate';
            onClickAction = `auditDeleteVideo(${v.id})`;
        }

        return `
            <div class="video-card">
                <div class="video-meta">
                    <span class="video-date">@${v.username} (ID: ${v.id})</span>
                    <span class="video-views">${fmtNum(v.play_count)} views</span>
                    <span class="video-profit">$${profit.toFixed(2)}</span>
                    <span class="badge badge-${v.is_eligible ? 'eligible' : 'ineligible'}">
                        ${v.is_eligible ? 'Eligible' : 'Ineligible'}
                    </span>
                    <span class="badge badge-${v.review_status}">
                        Current: ${v.review_status}
                    </span>
                </div>
                <div class="video-actions">
                    <a href="${v.web_video_url}" target="_blank" class="btn btn-outline btn-sm">View Post</a>
                    <button class="btn ${btnClass} btn-sm" onclick="${onClickAction}">${btnLabel}</button>
                </div>
            </div>
        `;
    }).join('');
}

async function auditReviewVideo(videoId, status) {
    try {
        await API.reviewVideo(videoId, status);
        showToast(`Video Fixed -> ${status}`, 'success');
        await runSystemAudit(); // Refresh the lists!
    } catch (err) {
        showToast(`Fix failed: ${err.message}`, 'error');
    }
}

async function auditDeleteVideo(videoId) {
    if (!confirm('Are you sure you want to permanently delete this video?')) return;
    try {
        await API.deleteVideo(videoId);
        showToast('Video deleted.', 'success');
        await runSystemAudit();
    } catch (err) {
        showToast(`Delete failed: ${err.message}`, 'error');
    }
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
            if (tab.dataset.tab === 'stats') loadGlobalStats();
            if (tab.dataset.tab === 'audit') runSystemAudit();
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
