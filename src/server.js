// ============================================================
// Clipnic Campaign Scraper — Express Server Entry Point
// ============================================================
// Updated for Vercel serverless deployment.
// ============================================================

require('dotenv').config();

const express = require('express');
const path = require('path');
const { logger, createModuleLogger } = require('./logger');
const { initDatabase, createTables } = require('./db/database');

const log = createModuleLogger('SERVER');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

// ---- Middleware ----
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 400 ? 'warn' : 'debug';
        log[level](`${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Static files (Vercel serves these via vercel.json, but we keep this for local dev)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- API Routes ----
const scraperRoutes = require('./routes/scraper');
const adminRoutes = require('./routes/admin');
const logRoutes = require('./routes/logs');

app.use('/api', scraperRoutes);
app.use('/api', adminRoutes);
app.use('/api', logRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// SPA fallback (Vercel rewrite handles this in production)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
    log.error(`Unhandled error: ${err.message}`, { stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Internal server error' });
});

// ---- Initialization ----
let isInitialized = false;

async function initializeApp() {
    if (isInitialized) return;
    try {
        log.info('=== CLIPNIC CAMPAIGN SCRAPER ===');
        log.info('Initializing PostgreSQL database connection...');
        initDatabase();
        
        // For Vercel, we might skip table creation on every request if it slows things down,
        // but for now, we'll keep it to ensure tables exist. 
        // Postgres `CREATE TABLE IF NOT EXISTS` is fast enough.
        await createTables();
        
        log.info(`API Token configured: ${process.env.APIFY_API_TOKEN && process.env.APIFY_API_TOKEN !== 'your_apify_token_here' ? 'YES' : 'NO — set APIFY_API_TOKEN in .env'}`);
        log.info(`Default CPM Rate: $${process.env.DEFAULT_CPM_RATE || 4}`);
        isInitialized = true;
    } catch (err) {
        log.error(`Initialization failed: ${err.message}`, { stack: err.stack });
        throw err; // Fail hard if we can't connect to the DB
    }
}

// ---- Start ----
if (IS_VERCEL) {
    // For Vercel serverless functions, we export the app and initialize on the first request
    // Note: Vercel might cold-start, so we init before handling requests in a wrapper or rely on top-level await (if supported).
    // The simplest pattern for Express on Vercel is to just export the app, but we need async init.
    
    // We'll use a middleware to ensure init before any request is processed.
    app.use(async (req, res, next) => {
        if (!isInitialized) {
            try {
                await initializeApp();
            } catch (err) {
                return res.status(500).json({ error: 'Database initialization failed' });
            }
        }
        next();
    });
    
    module.exports = app;
} else {
    // Local development mode
    initializeApp().then(() => {
        app.listen(PORT, () => {
            log.info(`Server running at http://localhost:${PORT}`);
        });
    }).catch(err => {
        log.error('Failed to start server:', err.message);
        process.exit(1);
    });
}
