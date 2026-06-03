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

    pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    pool.on('error', (err) => {
        log.error('Unexpected pool error:', { message: err.message });
    });

    log.info('PostgreSQL pool created');
    return pool;
}

async function createTables() {
    log.info('Creating tables if not exist...');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS scrape_jobs (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            after_date TEXT NOT NULL,
            cpm_rate REAL NOT NULL DEFAULT 4.0,
            status TEXT NOT NULL DEFAULT 'pending',
            total_videos INTEGER DEFAULT 0,
            apify_run_id TEXT,
            apify_dataset_id TEXT,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        );

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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_videos_job_id ON videos(job_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_videos_review_status ON videos(review_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_videos_play_count ON videos(play_count)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status)`);

    log.info('All tables and indexes created/verified');
}

// ---- Scrape Jobs ----

async function createJob(username, afterDate, cpmRate) {
    log.info(`Creating scrape job: username=${username}, afterDate=${afterDate}, cpmRate=${cpmRate}`);
    const result = await pool.query(
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
    if (extra.totalVideos !== undefined) { sets.push(`total_videos = $${paramIdx}`); params.push(extra.totalVideos); paramIdx++; }
    if (extra.errorMessage) { sets.push(`error_message = $${paramIdx}`); params.push(extra.errorMessage); paramIdx++; }
    if (status === 'completed' || status === 'failed') { sets.push('completed_at = NOW()'); }

    params.push(jobId);
    await pool.query(`UPDATE scrape_jobs SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
}

async function getJob(jobId) {
    const result = await pool.query('SELECT * FROM scrape_jobs WHERE id = $1', [jobId]);
    return result.rows[0] || null;
}

async function getAllJobs() {
    const result = await pool.query('SELECT * FROM scrape_jobs ORDER BY created_at DESC');
    return result.rows;
}

// ---- Videos ----

async function insertVideos(jobId, videos) {
    log.info(`Inserting ${videos.length} videos for job ${jobId}`);
    const startTime = Date.now();
    let inserted = 0;

    const client = await pool.connect();
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

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM videos ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const videoResult = await pool.query(
        `SELECT * FROM videos ${whereClause} ORDER BY play_count DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        params
    );

    return { videos: videoResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function updateVideoReview(videoId, status, notes = '') {
    log.info(`Reviewing video ${videoId}: status=${status}, notes=${notes}`);
    await pool.query(
        `UPDATE videos SET review_status = $1, review_notes = $2, reviewed_at = NOW() WHERE id = $3`,
        [status, notes, videoId]
    );
}

async function getJobMetrics(jobId) {
    log.debug(`Calculating metrics for job ${jobId}`);

    const result = await pool.query(`
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

async function getAllVideosForExport(jobId) {
    const result = await pool.query(
        'SELECT * FROM videos WHERE job_id = $1 ORDER BY play_count DESC', [jobId]
    );
    return result.rows;
}

function getPool() { return pool; }

module.exports = {
    initDatabase, createTables, getPool,
    createJob, updateJobStatus, getJob, getAllJobs,
    insertVideos, getVideosByJob, updateVideoReview,
    getJobMetrics, getAllVideosForExport
};
