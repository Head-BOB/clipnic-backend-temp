// ============================================================
// Clipnic Campaign Scraper — Analytics Calculator
// ============================================================
// CPM-based profit calculation with configurable rate.
// Eligible videos = ≥1,000 views.
// ============================================================

const { createModuleLogger } = require('../logger');
const log = createModuleLogger('ANALYTICS');

/**
 * Calculate all metrics for a set of videos
 * @param {Array} videos - Array of video objects with play_count
 * @param {number} cpmRate - Dollars per 1000 views
 * @returns {Object} Computed metrics
 */
function calculateMetrics(videos, cpmRate = 4) {
    log.info(`Calculating metrics for ${videos.length} videos at $${cpmRate} CPM`);

    const totalViews = videos.reduce((sum, v) => sum + (v.play_count || 0), 0);
    const eligibleVideos = videos.filter(v => (v.play_count || 0) >= 1000);
    const ineligibleVideos = videos.filter(v => (v.play_count || 0) < 1000);
    const eligibleViews = eligibleVideos.reduce((sum, v) => sum + v.play_count, 0);
    const ineligibleViews = ineligibleVideos.reduce((sum, v) => sum + (v.play_count || 0), 0);

    const grossProfit = (eligibleViews / 1000) * cpmRate;

    const approvedVideos = videos.filter(v => v.review_status === 'approved');
    const approvedViews = approvedVideos.reduce((sum, v) => sum + (v.play_count || 0), 0);
    const approvedEligibleViews = approvedVideos.filter(v => (v.play_count || 0) >= 1000)
        .reduce((sum, v) => sum + v.play_count, 0);
    const approvedProfit = (approvedEligibleViews / 1000) * cpmRate;

    const result = {
        totalVideos: videos.length,
        totalViews,
        eligibleCount: eligibleVideos.length,
        eligibleViews,
        ineligibleCount: ineligibleVideos.length,
        ineligibleViews,
        grossProfit: Math.round(grossProfit * 100) / 100,
        approvedCount: approvedVideos.length,
        approvedViews,
        approvedEligibleViews,
        approvedProfit: Math.round(approvedProfit * 100) / 100,
        rejectedCount: videos.filter(v => v.review_status === 'rejected').length,
        pendingCount: videos.filter(v => v.review_status === 'pending').length,
        cpmRate
    };

    log.info('Metrics calculated:', result);
    return result;
}

/**
 * Calculate profit for a single video
 */
function calculateVideoProfit(playCount, cpmRate = 4) {
    if (playCount < 1000) return 0;
    return Math.round(((playCount / 1000) * cpmRate) * 100) / 100;
}

module.exports = { calculateMetrics, calculateVideoProfit };
