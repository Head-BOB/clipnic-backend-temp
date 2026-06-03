// ============================================================
// Clipnic Campaign Scraper — Scraper API Routes
// ============================================================

const express = require('express');
const router = express.Router();
const { createModuleLogger } = require('../logger');
const { createJob, getJob, getAllJobs, deleteJob, getJobMetrics, getGlobalMetrics, getAllGlobalApprovedVideos, getAllGlobalVideos, getSystemAuditAnomalies, filterExistingUrls } = require('../db/database');
const { startScrape, startUrlScrape, startAccountScrape, syncJob } = require('../scraper/apify');

const log = createModuleLogger('API:SCRAPER');

router.post('/scrape', async (req, res) => {
    const startTime = Date.now();
    try {
        let { username, afterDate, cpmRate } = req.body;

        if (!username || !afterDate) {
            log.warn('Missing required fields', { username, afterDate });
            return res.status(400).json({ error: 'Missing required fields: username and afterDate' });
        }

        username = username.replace(/^@/, '').trim();
        if (!username) return res.status(400).json({ error: 'Invalid username' });

        cpmRate = parseFloat(cpmRate) || parseFloat(process.env.DEFAULT_CPM_RATE) || 4;

        const dateObj = new Date(afterDate);
        if (isNaN(dateObj.getTime())) return res.status(400).json({ error: 'Invalid date format' });

        const apiToken = process.env.APIFY_API_TOKEN;
        if (!apiToken || apiToken === 'your_apify_token_here') {
            log.error('APIFY_API_TOKEN not configured!');
            return res.status(500).json({ error: 'Apify API token not configured. Set APIFY_API_TOKEN in .env' });
        }

        log.info(`New scrape request: @${username}, after ${afterDate}, CPM $${cpmRate}`);

        const jobId = await createJob(username, afterDate, cpmRate);

        // Start the apify run, wait for it, but return before it finishes scraping
        const { runId } = await startScrape(username, jobId, apiToken);
        const elapsed = Date.now() - startTime;
        log.info(`Scrape job #${jobId} (Apify Run ${runId}) queued in ${elapsed}ms`);

        res.status(201).json({ success: true, jobId, message: `Scraping @${username} — this may take a few minutes.` });
    } catch (err) {
        log.error(`POST /scrape error: ${err.message}`, { stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});

router.post('/scrape/urls', async (req, res) => {
    try {
        const { urls, cpmRate } = req.body;
        if (!urls || urls.trim() === '') {
            return res.status(400).json({ error: 'Missing URLs list' });
        }

        const apiToken = process.env.APIFY_API_TOKEN;
        if (!apiToken || apiToken === 'your_apify_token_here') {
            return res.status(500).json({ error: 'Apify API token not configured.' });
        }

        const rawUrlList = urls.split(/[\n,]+/).map(u => u.trim()).filter(u => u.length > 5);
        const urlList = await filterExistingUrls(rawUrlList);

        if (urlList.length === 0) {
            return res.status(200).json({ success: true, jobsCreated: [], message: 'All submitted URLs already exist in the database. No new jobs created.' });
        }
        
        // Categorize by platform
        const tiktokUrls = urlList.filter(u => u.includes('tiktok.com'));
        const instaUrls = urlList.filter(u => u.includes('instagram.com'));
        const youtubeUrls = urlList.filter(u => u.includes('youtube.com') || u.includes('youtu.be'));
        const otherUrls = urlList.filter(u => !u.includes('tiktok.com') && !u.includes('instagram.com') && !u.includes('youtube.com') && !u.includes('youtu.be'));

        log.info(`Categorized URLs: ${tiktokUrls.length} TikTok, ${instaUrls.length} Insta, ${youtubeUrls.length} YouTube, ${otherUrls.length} Other`);

        const jobsCreated = [];

        if (tiktokUrls.length > 0) {
            const jobId = await createJob('External URLs (TikTok)', new Date(0).toISOString(), cpmRate || 4);
            await startUrlScrape('tiktok', tiktokUrls, jobId, apiToken);
            jobsCreated.push(jobId);
        }
        if (instaUrls.length > 0) {
            const jobId = await createJob('External URLs (Instagram)', new Date(0).toISOString(), cpmRate || 4);
            await startUrlScrape('instagram', instaUrls, jobId, apiToken);
            jobsCreated.push(jobId);
        }
        if (youtubeUrls.length > 0) {
            const jobId = await createJob('External URLs (YouTube)', new Date(0).toISOString(), cpmRate || 4);
            await startUrlScrape('youtube', youtubeUrls, jobId, apiToken);
            jobsCreated.push(jobId);
        }

        res.status(201).json({ success: true, jobsCreated, message: `Created ${jobsCreated.length} parallel scraper jobs for the submitted URLs.` });
    } catch (err) {
        log.error(`POST /scrape/urls error: ${err.message}`, { stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});

router.post('/scrape/accounts', async (req, res) => {
    try {
        const { urls, cpmRate, afterDate, minViews } = req.body;
        if (!urls || urls.trim() === '') {
            return res.status(400).json({ error: 'Missing URLs list' });
        }
        if (!afterDate) {
            return res.status(400).json({ error: 'Missing afterDate' });
        }

        const apiToken = process.env.APIFY_API_TOKEN;
        if (!apiToken || apiToken === 'your_apify_token_here') {
            return res.status(500).json({ error: 'Apify API token not configured.' });
        }

        const urlList = urls.split(/[\n,]+/).map(u => u.trim()).filter(u => u.length > 5);
        
        // Categorize by platform
        const tiktokUrls = urlList.filter(u => u.includes('tiktok.com'));
        const instaUrls = urlList.filter(u => u.includes('instagram.com'));
        const youtubeUrls = urlList.filter(u => u.includes('youtube.com') || u.includes('youtu.be'));

        log.info(`Account Scrape URLs: ${tiktokUrls.length} TikTok, ${instaUrls.length} Insta, ${youtubeUrls.length} YouTube`);

        const jobsCreated = [];
        const finalMinViews = parseInt(minViews) || 1000;

        if (tiktokUrls.length > 0) {
            const jobId = await createJob('Multi-Account (TikTok)', afterDate, cpmRate || 4, finalMinViews);
            await startAccountScrape('tiktok', tiktokUrls, jobId, apiToken);
            jobsCreated.push(jobId);
        }
        if (instaUrls.length > 0) {
            const jobId = await createJob('Multi-Account (Instagram)', afterDate, cpmRate || 4, finalMinViews);
            await startAccountScrape('instagram', instaUrls, jobId, apiToken);
            jobsCreated.push(jobId);
        }
        if (youtubeUrls.length > 0) {
            const jobId = await createJob('Multi-Account (YouTube)', afterDate, cpmRate || 4, finalMinViews);
            await startAccountScrape('youtube', youtubeUrls, jobId, apiToken);
            jobsCreated.push(jobId);
        }

        res.status(201).json({ success: true, jobsCreated, message: `Created ${jobsCreated.length} parallel account scraper jobs.` });
    } catch (err) {
        log.error(`POST /scrape/accounts error: ${err.message}`, { stack: err.stack });
        res.status(500).json({ error: err.message });
    }
});

router.get('/scrape/:jobId/status', async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const job = await getJob(jobId);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        let metrics = null;
        if (job.status === 'completed') metrics = await getJobMetrics(jobId);

        res.json({
            job: {
                id: job.id, username: job.username, afterDate: job.after_date,
                cpmRate: job.cpm_rate, status: job.status, totalVideos: job.total_videos,
                errorMessage: job.error_message, createdAt: job.created_at, completedAt: job.completed_at
            },
            metrics
        });
    } catch (err) {
        log.error(`GET /scrape/status error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/scrape/:jobId/sync', async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const job = await getJob(jobId);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        
        if (job.status === 'completed' || job.status === 'failed') {
            return res.json({ status: job.status });
        }

        const apiToken = process.env.APIFY_API_TOKEN;
        if (!apiToken || apiToken === 'your_apify_token_here') {
            return res.status(500).json({ error: 'Apify API token not configured.' });
        }

        // Trigger sync
        const result = await syncJob(job, apiToken);
        res.json(result);
    } catch (err) {
        log.error(`GET /scrape/sync error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.post('/scrape/refresh-approved', async (req, res) => {
    try {
        const apiToken = process.env.APIFY_API_TOKEN;
        if (!apiToken) {
            return res.status(500).json({ error: 'Apify API token not configured.' });
        }

        const videos = await getAllGlobalApprovedVideos();
        if (videos.length === 0) {
            return res.status(400).json({ error: 'No approved videos to refresh.' });
        }

        // Group by platform
        const platforms = { tiktok: [], instagram: [], youtube: [] };
        videos.forEach(v => {
            const url = v.web_video_url || '';
            if (url.includes('tiktok.com')) platforms.tiktok.push(url);
            else if (url.includes('instagram.com')) platforms.instagram.push(url);
            else if (url.includes('youtube.com') || url.includes('youtu.be')) platforms.youtube.push(url);
        });

        const createdJobs = [];
        const dateStr = new Date().toISOString().split('T')[0];

        // Create job & start scrape for each platform
        for (const [platform, urls] of Object.entries(platforms)) {
            if (urls.length === 0) continue;
            
            const jobName = `Refresh ${platform.toUpperCase()} (${dateStr})`;
            // use a default min_views and cpm_rate; the update logic will skip min_views rejection anyway since the video is already approved
            const jobId = await createJob(jobName, '2020-01-01', 4.0, 1000);
            await startUrlScrape(platform, urls, jobId, apiToken);
            createdJobs.push(jobId);
        }

        res.json({ success: true, createdJobs, message: `Started ${createdJobs.length} refresh jobs` });
    } catch (err) {
        log.error(`POST /scrape/refresh-approved error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/jobs', async (req, res) => {
    try {
        const jobs = await getAllJobs();
        res.json({ jobs });
    } catch (err) {
        log.error(`GET /jobs error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/scrape/:jobId', async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const job = await getJob(jobId);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        await deleteJob(jobId);
        res.json({ success: true, message: `Job #${jobId} deleted` });
    } catch (err) {
        log.error(`DELETE /scrape error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/metrics/global', async (req, res) => {
    try {
        const metrics = await getGlobalMetrics();
        res.json({ metrics });
    } catch (err) {
        log.error(`GET /metrics/global error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/audit/anomalies', async (req, res) => {
    try {
        const anomalies = await getSystemAuditAnomalies();
        res.json(anomalies);
    } catch (err) {
        log.error(`GET /audit/anomalies error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/export/approved-csv', async (req, res) => {
    try {
        const videos = await getAllGlobalApprovedVideos();

        if (videos.length === 0) {
            return res.status(404).send('No approved videos found.');
        }

        // Generate raw text content with just URLs
        let textContent = '';
        videos.forEach(v => {
            if (v.web_video_url) {
                textContent += v.web_video_url + '\n';
            }
        });

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename="clipnic_approved_urls.txt"');
        res.send(textContent);
        
    } catch (err) {
        log.error(`GET /export/approved-csv error: ${err.message}`);
        res.status(500).send('Error generating URL export');
    }
});

router.get('/export/approved-videos-json', async (req, res) => {
    try {
        const videos = await getAllGlobalApprovedVideos();
        res.json({ videos });
    } catch (err) {
        log.error(`GET /export/approved-videos-json error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/export/all-videos-json', async (req, res) => {
    try {
        const videos = await getAllGlobalVideos();
        res.json({ videos });
    } catch (err) {
        log.error(`GET /export/all-videos-json error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
