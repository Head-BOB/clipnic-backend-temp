// ============================================================
// Clipnic Campaign Scraper — Scraper API Routes
// ============================================================

const express = require('express');
const router = express.Router();
const { createModuleLogger } = require('../logger');
const { createJob, getJob, getAllJobs, getJobMetrics } = require('../db/database');
const { scrapeProfile } = require('../scraper/apify');

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

        // Start scraping in background (don't await — return immediately)
        scrapeProfile(username, afterDate, jobId, apiToken)
            .then(result => log.info(`Background scrape completed for job #${jobId}`, result))
            .catch(err => log.error(`Background scrape error for job #${jobId}: ${err.message}`));

        const elapsed = Date.now() - startTime;
        log.info(`Scrape job #${jobId} queued in ${elapsed}ms`);

        res.status(201).json({ success: true, jobId, message: `Scraping @${username} — this may take a few minutes.` });
    } catch (err) {
        log.error(`POST /scrape error: ${err.message}`, { stack: err.stack });
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

router.get('/jobs', async (req, res) => {
    try {
        const jobs = await getAllJobs();
        res.json({ jobs });
    } catch (err) {
        log.error(`GET /jobs error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
