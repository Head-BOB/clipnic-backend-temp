// ============================================================
// Clipnic Campaign Scraper — Log Viewer API Routes
// ============================================================
// Reads from in-memory buffer (works on Vercel) or files (local).
// ============================================================

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { createModuleLogger, getLogBuffer } = require('../logger');

const log = createModuleLogger('API:LOGS');
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const IS_VERCEL = !!process.env.VERCEL;

router.get('/logs', (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 100;
        const level = req.query.level || 'all';

        let logLines;

        if (IS_VERCEL) {
            // Read from in-memory buffer on Vercel
            logLines = getLogBuffer();
        } else {
            // Read from file locally
            const logFile = path.join(LOG_DIR, 'app.log');
            if (!fs.existsSync(logFile)) return res.json({ logs: [], message: 'No logs yet' });
            const content = fs.readFileSync(logFile, 'utf8');
            logLines = content.split('\n').filter(Boolean);
        }

        if (level !== 'all') {
            logLines = logLines.filter(l => l.includes(level.toUpperCase()));
        }

        const result = logLines.slice(-lines);
        res.json({ logs: result, total: logLines.length, showing: result.length });
    } catch (err) {
        log.error(`GET /logs error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

router.get('/logs/scraper', (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 100;

        let logLines;

        if (IS_VERCEL) {
            logLines = getLogBuffer().filter(l => l.includes('[SCRAPER]'));
        } else {
            const logFile = path.join(LOG_DIR, 'scraper.log');
            if (!fs.existsSync(logFile)) return res.json({ logs: [], message: 'No scraper logs yet' });
            const content = fs.readFileSync(logFile, 'utf8');
            logLines = content.split('\n').filter(Boolean);
        }

        const result = logLines.slice(-lines);
        res.json({ logs: result, total: logLines.length, showing: result.length });
    } catch (err) {
        log.error(`GET /logs/scraper error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
