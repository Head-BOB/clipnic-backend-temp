// ============================================================
// Clipnic Campaign Scraper — Apify TikTok Scraper Integration
// ============================================================

const { createModuleLogger } = require('../logger');
const { updateJobStatus, insertVideos } = require('../db/database');

const log = createModuleLogger('SCRAPER');
const APIFY_BASE_URL = 'https://api.apify.com/v2';

/**
 * Start the Apify run and instantly return
 */
async function startScrape(username, jobId, apiToken) {
    log.info(`=== STARTING APIFY RUN: @${username} (Job #${jobId}) ===`);
    
    await updateJobStatus(jobId, 'scraping');
    
    const url = `${APIFY_BASE_URL}/acts/clockworks~tiktok-scraper/runs?token=${apiToken}`;
    const input = {
        profiles: [username],
        resultsPerPage: 100,
        profileScrapeSections: ['videos'],
        profileSorting: 'latest',
        excludePinnedPosts: false,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSubtitles: false,
        shouldDownloadSlideshowImages: false,
        shouldDownloadAvatars: false,
        shouldDownloadMusicCovers: false,
        scrapeRelatedVideos: false
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        log.error(`Apify start run failed: HTTP ${response.status}`);
        await updateJobStatus(jobId, 'failed', { errorMessage: `Apify API Error: ${response.status}` });
        throw new Error(`Apify API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const runId = data.data.id;
    const datasetId = data.data.defaultDatasetId;
    
    log.info(`Apify run initiated`, { runId, datasetId });
    await updateJobStatus(jobId, 'scraping', { apifyRunId: runId, apifyDatasetId: datasetId });
    
    return { success: true, runId, datasetId };
}

/**
 * Start an Apify run for direct URLs (multi-platform)
 */
async function startUrlScrape(platform, urls, jobId, apiToken) {
    log.info(`=== STARTING APIFY URL RUN: ${platform} (${urls.length} urls) (Job #${jobId}) ===`);
    
    await updateJobStatus(jobId, 'scraping');
    
    let url = '';
    let input = {};

    if (platform === 'tiktok') {
        url = `${APIFY_BASE_URL}/acts/clockworks~tiktok-scraper/runs?token=${apiToken}`;
        input = { postURLs: urls, shouldDownloadVideos: false };
    } else if (platform === 'instagram') {
        url = `${APIFY_BASE_URL}/acts/apify~instagram-scraper/runs?token=${apiToken}`;
        input = { directUrls: urls, resultsType: 'details' };
    } else if (platform === 'youtube') {
        url = `${APIFY_BASE_URL}/acts/streamers~youtube-scraper/runs?token=${apiToken}`;
        input = { startUrls: urls.map(u => ({ url: u })) };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
    });

    if (!response.ok) {
        log.error(`Apify start URL run failed: HTTP ${response.status}`);
        await updateJobStatus(jobId, 'failed', { errorMessage: `Apify API Error: ${response.status}` });
        throw new Error(`Apify API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const runId = data.data.id;
    const datasetId = data.data.defaultDatasetId;
    
    log.info(`Apify URL run initiated`, { runId, datasetId });
    await updateJobStatus(jobId, 'scraping', { apifyRunId: runId, apifyDatasetId: datasetId });
    
    return { success: true, runId, datasetId };
}

/**
 * Start an Apify run for Account/Profile URLs (multi-platform)
 */
async function startAccountScrape(platform, urls, jobId, apiToken) {
    log.info(`=== STARTING APIFY ACCOUNT RUN: ${platform} (${urls.length} accounts) (Job #${jobId}) ===`);
    
    await updateJobStatus(jobId, 'scraping');
    
    let url = '';
    let input = {};

    if (platform === 'tiktok') {
        url = `${APIFY_BASE_URL}/acts/clockworks~tiktok-scraper/runs?token=${apiToken}`;
        // Extract usernames if they pasted URLs, strip query params
        const profiles = urls.map(u => {
            const cleanUrl = u.split('?')[0];
            const match = cleanUrl.match(/@([\w.-]+)/);
            return match ? match[1] : cleanUrl;
        });
        input = { 
            profiles: profiles,
            resultsPerPage: 100,
            profileScrapeSections: ['videos'],
            profileSorting: 'latest',
            shouldDownloadVideos: false 
        };
    } else if (platform === 'instagram') {
        url = `${APIFY_BASE_URL}/acts/apify~instagram-scraper/runs?token=${apiToken}`;
        const cleanUrls = urls.map(u => u.split('?')[0]);
        input = { directUrls: cleanUrls, resultsType: 'posts' };
    } else if (platform === 'youtube') {
        url = `${APIFY_BASE_URL}/acts/streamers~youtube-scraper/runs?token=${apiToken}`;
        const cleanUrls = urls.map(u => u.split('?')[0]);
        input = { startUrls: cleanUrls.map(u => ({ url: u })) };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
    });

    if (!response.ok) {
        log.error(`Apify start Account run failed: HTTP ${response.status}`);
        await updateJobStatus(jobId, 'failed', { errorMessage: `Apify API Error: ${response.status}` });
        throw new Error(`Apify API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const runId = data.data.id;
    const datasetId = data.data.defaultDatasetId;
    
    log.info(`Apify Account run initiated`, { runId, datasetId });
    await updateJobStatus(jobId, 'scraping', { apifyRunId: runId, apifyDatasetId: datasetId });
    
    return { success: true, runId, datasetId };
}

/**
 * Sync job state and stream dataset items from Apify to DB.
 * Safe for serverless polling (runs in < 1 second).
 */
async function syncJob(job, apiToken) {
    if (!job.apify_run_id) throw new Error("Job missing apify_run_id");

    const runId = job.apify_run_id;
    const datasetId = job.apify_dataset_id;
    
    // 1. Check Run Status
    const url = `${APIFY_BASE_URL}/actor-runs/${runId}?token=${apiToken}`;
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Failed to check run status: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const status = data.data.status;
    log.info(`Sync job #${job.id} — Apify Status: ${status}`);

    // 2. Fetch new dataset items if they exist
    let newVideosInserted = 0;
    if (datasetId) {
        const offset = job.apify_synced_count || 0;
        // Fetch up to 500 items at a time to prevent Vercel timeout
        const itemsUrl = `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${apiToken}&offset=${offset}&limit=500&format=json`;
        
        const dsRes = await fetch(itemsUrl);
        if (dsRes.ok) {
            const items = await dsRes.json();
            
            if (items.length > 0) {
                log.info(`Fetched ${items.length} new items from dataset (offset ${offset})`);
                
                // Transform first, then filter by date
                const afterDateTs = new Date(job.after_date).getTime();
                const transformed = items.map(transformVideo).filter(v => v !== null);
                
                const filtered = transformed.filter(v => {
                    const videoDateTs = new Date(v.createTimeISO).getTime();
                    // If we cannot parse the date, assume it's valid to be safe
                    if (isNaN(videoDateTs)) return true;
                    return videoDateTs >= afterDateTs;
                });

                if (filtered.length > 0) {
                    newVideosInserted = await insertVideos(job.id, filtered);
                }

                // Update sync count so we don't fetch these again
                const newTotal = (job.total_videos || 0) + newVideosInserted;
                const newSyncCount = offset + items.length;
                
                await updateJobStatus(job.id, 'scraping', { 
                    totalVideos: newTotal,
                    apifySyncedCount: newSyncCount
                });
            }
        }
    }

    // 3. Mark completed if finished
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        if (status === 'SUCCEEDED') {
            await updateJobStatus(job.id, 'completed');
            return { status: 'completed' };
        } else {
            await updateJobStatus(job.id, 'failed', { errorMessage: `Apify run ended with status: ${status}` });
            return { status: 'failed' };
        }
    }

    return { status: 'scraping' };
}

function transformVideo(item) {
    // TIKTOK (clockworks)
    if (item.webVideoUrl || item.videoMeta) {
        return {
            id: item.id || '',
            webVideoUrl: item.webVideoUrl || '',
            text: (item.text || '').substring(0, 500),
            playCount: item.playCount || 0,
            diggCount: item.diggCount || 0,
            shareCount: item.shareCount || 0,
            commentCount: item.commentCount || 0,
            collectCount: item.collectCount || 0,
            duration: item.videoMeta?.duration || 0,
            coverUrl: item.videoMeta?.coverUrl || '',
            createTimeISO: item.createTimeISO || '',
            authorName: item.authorMeta?.name || '',
            authorNickname: item.authorMeta?.nickName || '',
            authorAvatar: item.authorMeta?.avatar || '',
            authorFans: item.authorMeta?.fans || 0
        };
    }

    // INSTAGRAM (apify~instagram-scraper)
    if (item.url && item.url.includes('instagram.com')) {
        return {
            id: item.id || item.shortCode || String(Math.random()),
            webVideoUrl: item.url,
            text: (item.caption || '').substring(0, 500),
            playCount: item.videoPlayCount || item.videoViewCount || item.playCount || item.viewCount || 0,
            diggCount: item.likesCount || 0,
            shareCount: 0,
            commentCount: item.commentsCount || 0,
            collectCount: 0, duration: 0, coverUrl: item.displayUrl || '',
            createTimeISO: item.timestamp || new Date().toISOString(),
            authorName: item.ownerUsername || item.ownerFullName || '',
            authorNickname: '', authorAvatar: '', authorFans: 0
        };
    }

    // YOUTUBE
    if (item.url && item.url.includes('youtube.com')) {
        return {
            id: item.id || String(Math.random()),
            webVideoUrl: item.url,
            text: (item.title || item.text || '').substring(0, 500),
            playCount: item.viewCount || item.views || 0,
            diggCount: item.likes || item.likesCount || 0,
            shareCount: 0,
            commentCount: item.comments || item.commentsCount || 0,
            collectCount: 0, duration: 0, coverUrl: item.thumbnailUrl || '',
            createTimeISO: item.date || item.uploadDate || new Date().toISOString(),
            authorName: item.channelName || item.uploader || '',
            authorNickname: '', authorAvatar: '', authorFans: 0
        };
    }

    // FALLBACK
    return {
        id: item.id || String(Math.random()),
        webVideoUrl: item.url || item.webVideoUrl || '',
        text: (item.title || item.caption || item.text || '').substring(0, 500),
        playCount: item.videoPlayCount || item.playCount || item.viewCount || item.videoViewCount || item.views || 0,
        diggCount: item.likesCount || item.diggCount || item.likes || 0,
        shareCount: item.shareCount || 0,
        commentCount: item.commentsCount || item.commentCount || item.comments || 0,
        collectCount: 0, duration: 0, coverUrl: '',
        createTimeISO: new Date().toISOString(),
        authorName: item.ownerUsername || item.channelName || item.authorMeta?.name || '',
        authorNickname: '', authorAvatar: '', authorFans: 0
    };
}

module.exports = { startScrape, startUrlScrape, startAccountScrape, syncJob };
