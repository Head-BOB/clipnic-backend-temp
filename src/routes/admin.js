// ============================================================
// Clipnic Campaign Scraper — Admin Review API Routes
// ============================================================

const express = require('express');
const router = express.Router();
const { createModuleLogger } = require('../logger');
const { getVideosByJob, updateVideoReview, getJobMetrics, getJob, getAllVideosForExport } = require('../db/database');
const { calculateVideoProfit } = require('../analytics/calculator');
const { generateReport } = require('../analytics/pdf-export');

const log = createModuleLogger('API:ADMIN');

router.get('/videos/:jobId', async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const filter = req.query.filter || 'all';
        log.info(`Fetching videos: job=${jobId}, page=${page}, limit=${limit}, filter=${filter}`);
        const result = await getVideosByJob(jobId, page, limit, filter);
        const job = await getJob(jobId);
        const cpmRate = job ? job.cpm_rate : 4;
        result.videos = result.videos.map(v => ({
            ...v, profit: calculateVideoProfit(v.play_count, cpmRate), is_eligible: v.is_eligible === true
        }));
        res.json(result);
    } catch (err) {
        log.error(`GET /videos error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.post('/videos/:videoId/review', async (req, res) => {
    try {
        const videoId = parseInt(req.params.videoId);
        const { status, notes } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
        }
        log.info(`Reviewing video ${videoId}: ${status}`, { notes });
        await updateVideoReview(videoId, status, notes || '');
        res.json({ success: true, videoId, status });
    } catch (err) {
        log.error(`POST /videos/review error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/videos/:jobId/summary', async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const metrics = await getJobMetrics(jobId);
        const job = await getJob(jobId);
        res.json({
            job: job ? { id: job.id, username: job.username, afterDate: job.after_date, cpmRate: job.cpm_rate, status: job.status, createdAt: job.created_at } : null,
            metrics
        });
    } catch (err) {
        log.error(`GET /summary error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/videos/:jobId/export-pdf', async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        log.info(`Generating PDF for job #${jobId}`);
        const job = await getJob(jobId);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        const videos = await getAllVideosForExport(jobId);
        const metrics = await getJobMetrics(jobId);
        const approvedVideos = videos.filter(v => v.review_status === 'approved');
        const fullMetrics = {
            totalVideos: videos.length,
            totalViews: videos.reduce((s, v) => s + v.play_count, 0),
            eligibleCount: videos.filter(v => v.play_count >= 1000).length,
            eligibleViews: videos.filter(v => v.play_count >= 1000).reduce((s, v) => s + v.play_count, 0),
            ineligibleCount: videos.filter(v => v.play_count < 1000).length,
            approvedCount: approvedVideos.length,
            rejectedCount: videos.filter(v => v.review_status === 'rejected').length,
            pendingCount: videos.filter(v => v.review_status === 'pending').length,
            approvedViews: approvedVideos.reduce((s, v) => s + v.play_count, 0),
            approvedEligibleViews: approvedVideos.filter(v => v.play_count >= 1000).reduce((s, v) => s + v.play_count, 0),
            grossProfit: metrics.gross_profit, approvedProfit: metrics.approved_profit, cpmRate: job.cpm_rate
        };
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="clipnic-report-${job.username}-${Date.now()}.pdf"`);
        generateReport(job, videos, fullMetrics, res);
    } catch (err) {
        log.error(`GET /export-pdf error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
