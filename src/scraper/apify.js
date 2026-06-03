// ============================================================
// Clipnic Campaign Scraper — Apify TikTok Scraper Integration
// ============================================================
// Handles communication with the Apify API to scrape TikTok
// profiles. Designed for accounts with 1000s of videos:
//   - Pagination via resultsPerPage
//   - Polling with exponential backoff
//   - Date filtering after retrieval
//   - Chunked database insertion
//   - Heavy logging at every step
// ============================================================

const { createModuleLogger } = require('../logger');
const { updateJobStatus, insertVideos } = require('../db/database');

const log = createModuleLogger('SCRAPER');

const APIFY_BASE_URL = 'https://api.apify.com/v2';

// Rate limiting: max 1 concurrent scrape, queue the rest
let activeScrapes = 0;
const MAX_CONCURRENT = 1;
const scrapeQueue = [];

/**
 * Main entry point: scrape a TikTok profile for videos after a given date.
 * Handles the full lifecycle: start run → poll → fetch → filter → store.
 *
 * @param {string} username - TikTok username (without @)
 * @param {string} afterDate - ISO date string, only videos after this date
 * @param {number} jobId - Database job ID
 * @param {string} apiToken - Apify API token
 * @returns {Promise<{success: boolean, videoCount: number, error?: string}>}
 */
async function scrapeProfile(username, afterDate, jobId, apiToken) {
    log.info(`=== SCRAPE REQUEST: @${username} after ${afterDate} (Job #${jobId}) ===`);

    // Queue if too many concurrent scrapes
    if (activeScrapes >= MAX_CONCURRENT) {
        log.warn(`Max concurrent scrapes (${MAX_CONCURRENT}) reached. Queuing job #${jobId}...`);
        await new Promise(resolve => scrapeQueue.push(resolve));
    }

    activeScrapes++;
    log.info(`Active scrapes: ${activeScrapes}`);

    try {
        // Step 1: Start the Apify run
        await updateJobStatus(jobId, 'scraping');
        const runId = await startApifyRun(username, apiToken);
        log.info(`Apify run started: runId=${runId}`);
        await updateJobStatus(jobId, 'scraping', { apifyRunId: runId });

        // Step 2: Poll until complete
        const runResult = await pollRunCompletion(runId, apiToken);
        log.info(`Apify run completed. Dataset ID: ${runResult.datasetId}, Status: ${runResult.status}`);

        if (runResult.status !== 'SUCCEEDED') {
            const errMsg = `Apify run failed with status: ${runResult.status}`;
            log.error(errMsg);
            await updateJobStatus(jobId, 'failed', { errorMessage: errMsg });
            return { success: false, videoCount: 0, error: errMsg };
        }

        await updateJobStatus(jobId, 'processing', { apifyDatasetId: runResult.datasetId });

        // Step 3: Fetch dataset items in pages (handles 1000s of results)
        const allItems = await fetchDatasetItems(runResult.datasetId, apiToken);
        log.info(`Total raw items fetched from Apify: ${allItems.length}`);

        // Step 4: Filter by date and transform
        const afterDateTs = new Date(afterDate).getTime();
        const filteredVideos = allItems
            .filter(item => {
                // Skip error items from Apify
                if (item.errorCode) {
                    log.warn(`Skipping error item: ${item.errorCode} - ${item.error}`);
                    return false;
                }
                const videoDate = new Date(item.createTimeISO).getTime();
                return videoDate >= afterDateTs;
            })
            .map(transformVideo);

        log.info(`Videos after date filter (>= ${afterDate}): ${filteredVideos.length}/${allItems.length}`);

        // Step 5: Insert into database in chunks (prevent memory issues)
        const CHUNK_SIZE = 200;
        let totalInserted = 0;
        for (let i = 0; i < filteredVideos.length; i += CHUNK_SIZE) {
            const chunk = filteredVideos.slice(i, i + CHUNK_SIZE);
            const inserted = await insertVideos(jobId, chunk);
            totalInserted += inserted;
            log.info(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: inserted ${inserted} videos (${totalInserted}/${filteredVideos.length} total)`);
        }

        await updateJobStatus(jobId, 'completed', { totalVideos: totalInserted });
        log.info(`=== SCRAPE COMPLETE: @${username} — ${totalInserted} videos stored ===`);

        return { success: true, videoCount: totalInserted };

    } catch (err) {
        log.error(`Scrape failed for @${username}: ${err.message}`, { stack: err.stack });
        await updateJobStatus(jobId, 'failed', { errorMessage: err.message });
        return { success: false, videoCount: 0, error: err.message };
    } finally {
        activeScrapes--;
        // Release next in queue
        if (scrapeQueue.length > 0) {
            const next = scrapeQueue.shift();
            next();
        }
        log.info(`Active scrapes after cleanup: ${activeScrapes}`);
    }
}

/**
 * Start an Apify actor run for the TikTok scraper
 */
async function startApifyRun(username, apiToken) {
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

    log.info(`Starting Apify run for @${username}`, { url: url.replace(apiToken, '***'), input });

    const startTime = Date.now();
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        log.error(`Apify start run failed: HTTP ${response.status}`, { body: errorBody });
        throw new Error(`Apify API error: HTTP ${response.status} — ${errorBody}`);
    }

    const data = await response.json();
    const elapsed = Date.now() - startTime;
    log.info(`Apify run initiated in ${elapsed}ms`, { runId: data.data.id, actorId: data.data.actId });

    return data.data.id;
}

/**
 * Poll Apify run until it completes. Uses exponential backoff.
 * Initial poll at 3s, max 30s between polls, max 15 minutes total.
 */
async function pollRunCompletion(runId, apiToken) {
    const url = `${APIFY_BASE_URL}/actor-runs/${runId}?token=${apiToken}`;
    const MAX_WAIT = 15 * 60 * 1000; // 15 minutes
    const startTime = Date.now();
    let pollInterval = 3000; // start at 3s
    let pollCount = 0;

    while (true) {
        pollCount++;
        const elapsed = Date.now() - startTime;

        if (elapsed > MAX_WAIT) {
            throw new Error(`Apify run timed out after ${MAX_WAIT / 1000}s`);
        }

        log.info(`Polling run status (attempt #${pollCount}, ${Math.round(elapsed / 1000)}s elapsed)...`);

        const response = await fetch(url);
        if (!response.ok) {
            log.warn(`Poll request failed: HTTP ${response.status}, retrying...`);
            await sleep(pollInterval);
            continue;
        }

        const data = await response.json();
        const status = data.data.status;
        const datasetId = data.data.defaultDatasetId;

        log.info(`Run status: ${status}`, {
            datasetId,
            usageTotalUsd: data.data.usageTotalUsd,
            statsPages: data.data.stats?.pagesLoaded
        });

        if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
            return { status, datasetId, usage: data.data.usageTotalUsd };
        }

        // Exponential backoff: 3s → 5s → 8s → 13s → 20s → 30s (capped)
        await sleep(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, 30000);
    }
}

/**
 * Fetch all items from an Apify dataset with pagination.
 * Fetches 1000 items at a time to handle large profiles.
 */
async function fetchDatasetItems(datasetId, apiToken) {
    const allItems = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    let pageNum = 0;

    while (true) {
        pageNum++;
        const url = `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${apiToken}&offset=${offset}&limit=${PAGE_SIZE}&format=json`;

        log.info(`Fetching dataset page ${pageNum} (offset=${offset}, limit=${PAGE_SIZE})...`);
        const startTime = Date.now();

        const response = await fetch(url);
        if (!response.ok) {
            const body = await response.text();
            log.error(`Dataset fetch failed: HTTP ${response.status}`, { body });
            throw new Error(`Failed to fetch dataset: HTTP ${response.status}`);
        }

        const items = await response.json();
        const elapsed = Date.now() - startTime;

        log.info(`Dataset page ${pageNum}: got ${items.length} items in ${elapsed}ms`);

        if (items.length === 0) {
            log.info(`No more items, total fetched: ${allItems.length}`);
            break;
        }

        allItems.push(...items);
        offset += items.length;

        // Safety valve: if we got less than PAGE_SIZE, we're done
        if (items.length < PAGE_SIZE) {
            log.info(`Last page (got ${items.length} < ${PAGE_SIZE}), total: ${allItems.length}`);
            break;
        }

        // Small delay between pages to be kind to the free API
        await sleep(500);
    }

    return allItems;
}

/**
 * Transform a raw Apify item into our standardized video object
 */
function transformVideo(item) {
    return {
        id: item.id || '',
        webVideoUrl: item.webVideoUrl || '',
        text: (item.text || '').substring(0, 500), // Cap description length
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { scrapeProfile };
