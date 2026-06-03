// ============================================================
// Clipnic Campaign Scraper — PostgreSQL Database (Supabase)
// ============================================================
// Migrated from SQLite to PostgreSQL for Vercel deployment.
// Uses 'pg' (node-postgres) with a connection pool.
// All functions are async.
// ============================================================

const { Pool } = require('pg');
const { createModuleLogger } = require('../logger');

const log = createModuleLogger('DB');

let pool;

function initDatabase() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        log.error('DATABASE_URL is not set! Please configure it in .env');
        throw new Error('DATABASE_URL environment variable is required');
    }

    log.info('Initializing PostgreSQL connection pool...');

    // Use global object to cache the pool across hot-reloads in serverless
    if (!global.__dbPool) {
        global.__dbPool = new Pool({
            connectionString,
            ssl: { rejectUnauthorized: false },
            max: 1, // Max 1 connection per Vercel lambda (Supabase limit is 15)
            idleTimeoutMillis: 1000, 
            connectionTimeoutMillis: 10000,
            allowExitOnIdle: true
        });

        global.__dbPool.on('error', (err) => {
            log.error('Unexpected pool error:', { message: err.message });
        });
        
        log.info('PostgreSQL pool created (Serverless optimized)');
    } else {
        log.info('Reusing existing PostgreSQL pool from global cache');
    }

    pool = global.__dbPool;
    return pool;
}

// Wrapper to automatically retry queries if EMAXCONNSESSION is hit
async function dbQuery(sql, params = [], retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await pool.query(sql, params);
        } catch (err) {
            if (err.message && err.message.includes('EMAXCONNSESSION') && i < retries - 1) {
                log.warn(`Database connection limit hit (EMAXCONNSESSION). Retrying in 1s... (${i+1}/${retries})`);
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 500)); // Jitter
            } else {
                throw err;
            }
        }
    }
}

// Wrapper to automatically retry connections for transactions
async function dbConnect(retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await pool.connect();
        } catch (err) {
            if (err.message && err.message.includes('EMAXCONNSESSION') && i < retries - 1) {
                log.warn(`Database connection limit hit (EMAXCONNSESSION) on connect. Retrying in 1s... (${i+1}/${retries})`);
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
            } else {
                throw err;
            }
        }
    }
}

async function createTables() {
    log.info('Creating tables if not exist...');

    await dbQuery(`
        CREATE TABLE IF NOT EXISTS scrape_jobs (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            after_date TEXT NOT NULL,
            cpm_rate REAL NOT NULL DEFAULT 4.0,
            status TEXT NOT NULL DEFAULT 'pending',
            total_videos INTEGER DEFAULT 0,
            apify_run_id TEXT,
            apify_dataset_id TEXT,
            apify_synced_count INTEGER DEFAULT 0,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        );

        ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS apify_synced_count INTEGER DEFAULT 0;


        CREATE TABLE IF NOT EXISTS videos (
            id SERIAL PRIMARY KEY,
            job_id INTEGER NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
            tiktok_id TEXT NOT NULL,
            web_video_url TEXT NOT NULL,
            description TEXT DEFAULT '',
            play_count INTEGER NOT NULL DEFAULT 0,
            digg_count INTEGER NOT NULL DEFAULT 0,
            share_count INTEGER NOT NULL DEFAULT 0,
            comment_count INTEGER NOT NULL DEFAULT 0,
            collect_count INTEGER NOT NULL DEFAULT 0,
            duration INTEGER DEFAULT 0,
            cover_url TEXT DEFAULT '',
            created_time_iso TEXT NOT NULL,
            author_name TEXT DEFAULT '',
            author_nickname TEXT DEFAULT '',
            author_avatar TEXT DEFAULT '',
            author_fans INTEGER DEFAULT 0,
            is_eligible BOOLEAN NOT NULL DEFAULT false,
            review_status TEXT NOT NULL DEFAULT 'pending',
            review_notes TEXT DEFAULT '',
            reviewed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(job_id, tiktok_id)
        );
    `);

    // Create indexes (IF NOT EXISTS for safety)
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_videos_job_id ON videos(job_id)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_videos_review_status ON videos(review_status)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_videos_play_count ON videos(play_count)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status)`);

    log.info('All tables and indexes created/verified');
}

// ---- Scrape Jobs ----

async function createJob(username, afterDate, cpmRate) {
    log.info(`Creating scrape job: username=${username}, afterDate=${afterDate}, cpmRate=${cpmRate}`);
    const result = await dbQuery(
        `INSERT INTO scrape_jobs (username, after_date, cpm_rate, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
        [username, afterDate, cpmRate]
    );
    const jobId = result.rows[0].id;
    log.info(`Scrape job created with ID: ${jobId}`);
    return jobId;
}

async function updateJobStatus(jobId, status, extra = {}) {
    log.info(`Updating job ${jobId} status to: ${status}`, extra);
    const sets = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    let paramIdx = 2;

    if (extra.apifyRunId) { sets.push(`apify_run_id = $${paramIdx}`); params.push(extra.apifyRunId); paramIdx++; }
    if (extra.apifyDatasetId) { sets.push(`apify_dataset_id = $${paramIdx}`); params.push(extra.apifyDatasetId); paramIdx++; }
    if (extra.apifySyncedCount !== undefined) { sets.push(`apify_synced_count = $${paramIdx}`); params.push(extra.apifySyncedCount); paramIdx++; }
    if (extra.totalVideos !== undefined) { sets.push(`total_videos = $${paramIdx}`); params.push(extra.totalVideos); paramIdx++; }
    if (extra.errorMessage) { sets.push(`error_message = $${paramIdx}`); params.push(extra.errorMessage); paramIdx++; }
    if (status === 'completed' || status === 'failed') { sets.push('completed_at = NOW()'); }

    params.push(jobId);
    await dbQuery(`UPDATE scrape_jobs SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
}

async function getJob(jobId) {
    const result = await dbQuery('SELECT * FROM scrape_jobs WHERE id = $1', [jobId]);
    return result.rows[0] || null;
}

async function deleteJob(jobId) {
    log.info(`Deleting job ${jobId} and its cascaded videos`);
    await dbQuery('DELETE FROM scrape_jobs WHERE id = $1', [jobId]);
}

async function getAllJobs() {
    const result = await dbQuery('SELECT * FROM scrape_jobs ORDER BY created_at DESC');
    return result.rows;
}

// ---- Videos ----

async function insertVideos(jobId, videos) {
    log.info(`Inserting ${videos.length} videos for job ${jobId}`);
    const startTime = Date.now();
    let inserted = 0;

    const client = await dbConnect();
    try {
        await client.query('BEGIN');

        for (const v of videos) {
            const isEligible = (v.playCount || 0) >= 1000;
            const result = await client.query(
                `INSERT INTO videos (
                    job_id, tiktok_id, web_video_url, description, play_count,
                    digg_count, share_count, comment_count, collect_count,
                    duration, cover_url, created_time_iso,
                    author_name, author_nickname, author_avatar, author_fans,
                    is_eligible
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                ON CONFLICT (job_id, tiktok_id) DO NOTHING`,
                [
                    jobId, v.id || '', v.webVideoUrl || '', (v.text || '').substring(0, 500),
                    v.playCount || 0, v.diggCount || 0, v.shareCount || 0,
                    v.commentCount || 0, v.collectCount || 0, v.duration || 0,
                    v.coverUrl || '', v.createTimeISO || '',
                    v.authorName || '', v.authorNickname || '',
                    v.authorAvatar || '', v.authorFans || 0, isEligible
                ]
            );
            if (result.rowCount > 0) inserted++;
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        log.error(`Insert transaction failed: ${err.message}`);
        throw err;
    } finally {
        client.release();
    }

    const elapsed = Date.now() - startTime;
    log.info(`Inserted ${inserted}/${videos.length} videos in ${elapsed}ms for job ${jobId}`);
    return inserted;
}

async function getVideosByJob(jobId, page = 1, limit = 50, filter = 'all') {
    log.debug(`Fetching videos for job ${jobId}, page=${page}, limit=${limit}, filter=${filter}`);
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE job_id = $1';
    const params = [jobId];
    let paramIdx = 2;

    if (filter === 'eligible') { whereClause += ' AND is_eligible = true'; }
    else if (filter === 'ineligible') { whereClause += ' AND is_eligible = false'; }
    else if (filter === 'pending') { whereClause += ` AND review_status = 'pending'`; }
    else if (filter === 'approved') { whereClause += ` AND review_status = 'approved'`; }
    else if (filter === 'rejected') { whereClause += ` AND review_status = 'rejected'`; }

    const countResult = await dbQuery(`SELECT COUNT(*) as count FROM videos ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const videoResult = await dbQuery(
        `SELECT * FROM videos ${whereClause} ORDER BY play_count DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        params
    );

    return { videos: videoResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function updateVideoReview(videoId, status, notes = '') {
    log.info(`Reviewing video ${videoId}: status=${status}, notes=${notes}`);
    await dbQuery(
        `UPDATE videos SET review_status = $1, review_notes = $2, reviewed_at = NOW() WHERE id = $3`,
        [status, notes, videoId]
    );
}

async function getJobMetrics(jobId) {
    log.debug(`Calculating metrics for job ${jobId}`);

    const result = await dbQuery(`
        SELECT
            COUNT(*)::int as total_videos,
            COALESCE(SUM(play_count), 0)::bigint as total_views,
            COALESCE(SUM(CASE WHEN is_eligible THEN play_count ELSE 0 END), 0)::bigint as eligible_views,
            COALESCE(SUM(CASE WHEN is_eligible THEN 1 ELSE 0 END), 0)::int as eligible_count,
            COALESCE(SUM(CASE WHEN NOT is_eligible THEN 1 ELSE 0 END), 0)::int as ineligible_count,
            COALESCE(SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END), 0)::int as approved_count,
            COALESCE(SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END), 0)::int as rejected_count,
            COALESCE(SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END), 0)::int as pending_count,
            COALESCE(SUM(CASE WHEN review_status = 'approved' THEN play_count ELSE 0 END), 0)::bigint as approved_views,
            COALESCE(SUM(CASE WHEN review_status = 'approved' AND is_eligible THEN play_count ELSE 0 END), 0)::bigint as approved_eligible_views
        FROM videos WHERE job_id = $1
    `, [jobId]);

    const metrics = result.rows[0];
    const job = await getJob(jobId);
    const cpmRate = job ? job.cpm_rate : 4;

    return {
        ...metrics,
        cpm_rate: cpmRate,
        gross_profit: (Number(metrics.eligible_views) / 1000) * cpmRate,
        approved_profit: (Number(metrics.approved_eligible_views) / 1000) * cpmRate
    };
}

async function getGlobalMetrics() {
    log.debug(`Calculating global metrics across all campaigns`);
    const result = await dbQuery(`
        SELECT
            COUNT(v.id)::int as total_videos,
            COALESCE(SUM(v.play_count), 0)::bigint as total_views,
            COALESCE(SUM(CASE WHEN v.is_eligible THEN v.play_count ELSE 0 END), 0)::bigint as eligible_views,
            COALESCE(SUM(CASE WHEN v.review_status = 'approved' THEN 1 ELSE 0 END), 0)::int as approved_count,
            COALESCE(SUM(CASE WHEN v.review_status = 'approved' THEN v.play_count ELSE 0 END), 0)::bigint as approved_views,
            COALESCE(SUM(CASE WHEN v.is_eligible THEN (v.play_count::numeric / 1000.0) * j.cpm_rate ELSE 0 END), 0)::numeric as gross_profit,
            COALESCE(SUM(CASE WHEN v.review_status = 'approved' AND v.is_eligible THEN (v.play_count::numeric / 1000.0) * j.cpm_rate ELSE 0 END), 0)::numeric as approved_profit
        FROM videos v
        JOIN scrape_jobs j ON v.job_id = j.id
    `);
    return result.rows[0];
}

async function getAllVideosForExport(jobId) {
    const result = await dbQuery(
        'SELECT * FROM videos WHERE job_id = $1 ORDER BY play_count DESC', [jobId]
    );
    return result.rows;
}

async function getAllGlobalApprovedVideos() {
    const result = await dbQuery(`
        SELECT v.*, j.username, j.cpm_rate 
        FROM videos v
        JOIN scrape_jobs j ON v.job_id = j.id
        WHERE v.review_status = 'approved'
        ORDER BY v.reviewed_at DESC, v.play_count DESC
    `);
    return result.rows;
}

async function getSystemAuditAnomalies() {
    log.debug(`Running system audit for anomalies`);
    
    const falseNegatives = await dbQuery(`
        SELECT v.*, j.username, j.cpm_rate 
        FROM videos v
        JOIN scrape_jobs j ON v.job_id = j.id
        WHERE v.is_eligible = true AND v.review_status != 'approved'
        ORDER BY v.play_count DESC
    `);
    
    const falsePositives = await dbQuery(`
        SELECT v.*, j.username, j.cpm_rate 
        FROM videos v
        JOIN scrape_jobs j ON v.job_id = j.id
        WHERE v.is_eligible = false AND v.review_status = 'approved'
        ORDER BY v.play_count DESC
    `);
    
    return {
        falseNegatives: falseNegatives.rows,
        falsePositives: falsePositives.rows
    };
}

function getPool() { return pool; }

module.exports = {
    initDatabase, createTables, getPool,
    createJob, updateJobStatus, getJob,    getAllJobs,
    deleteJob,
    insertVideos, getVideosByJob, updateVideoReview,
    getJobMetrics, getGlobalMetrics, getAllVideosForExport, getAllGlobalApprovedVideos,
    getSystemAuditAnomalies
};
