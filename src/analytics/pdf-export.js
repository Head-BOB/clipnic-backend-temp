// ============================================================
// Clipnic Campaign Scraper — PDF Export
// ============================================================
// Generates professional PDF reports with Clipnic branding,
// watermark, video details, and analytics summary.
// ============================================================

const PDFDocument = require('pdfkit');
const { createModuleLogger } = require('../logger');
const { calculateVideoProfit } = require('./calculator');

const log = createModuleLogger('PDF');

// Brand colors
const BRAND = {
    primary: '#6366f1',
    primaryRgb: [99, 102, 241],
    dark: '#0a0a0f',
    darkRgb: [10, 10, 15],
    text: '#e2e8f0',
    textRgb: [226, 232, 240],
    muted: '#94a3b8',
    mutedRgb: [148, 163, 184],
    success: '#10b981',
    successRgb: [16, 185, 129],
    error: '#ef4444',
    errorRgb: [239, 68, 68],
    white: '#ffffff',
    whiteRgb: [255, 255, 255],
    accent: '#8b5cf6',
    accentRgb: [139, 92, 246]
};

/**
 * Generate a professional PDF report
 * @param {Object} job - The scrape job
 * @param {Array} videos - All videos for the job
 * @param {Object} metrics - Calculated metrics
 * @param {import('stream').Writable} outputStream - Write destination
 */
function generateReport(job, videos, metrics, outputStream) {
    log.info(`Generating PDF report for job #${job.id} (@${job.username})`);
    const startTime = Date.now();

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
        info: {
            Title: `Clipnic Campaign Report — @${job.username}`,
            Author: 'Clipnic.com',
            Subject: 'TikTok Campaign Analytics',
            Creator: 'Clipnic Campaign Scraper'
        }
    });

    doc.pipe(outputStream);

    // ---- Page 1: Cover / Summary ----
    drawCoverPage(doc, job, metrics);

    // ---- Page 2+: Video Details ----
    doc.addPage();
    drawVideoDetails(doc, job, videos, metrics.cpmRate);

    // Add watermark to all pages
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        drawWatermark(doc);
        drawFooter(doc, i + 1, pageCount);
    }

    doc.end();

    const elapsed = Date.now() - startTime;
    log.info(`PDF generated in ${elapsed}ms, ${pageCount} pages`);
}

function drawCoverPage(doc, job, metrics) {
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // Header accent bar
    doc.rect(0, 0, pageWidth, 6).fill(BRAND.primary);

    // Logo text
    doc.fontSize(36).font('Helvetica-Bold')
        .fillColor(BRAND.primary)
        .text('CLIPNIC', 50, 60, { align: 'left' });
    doc.fontSize(10).font('Helvetica')
        .fillColor(...BRAND.mutedRgb)
        .text('clipnic.com', 50, 100, { align: 'left' });

    // Report title
    doc.moveDown(3);
    doc.fontSize(24).font('Helvetica-Bold')
        .fillColor(...BRAND.darkRgb)
        .text('Campaign Analytics Report', 50, 150, { align: 'center' });

    // Profile info
    doc.fontSize(16).font('Helvetica')
        .fillColor(...BRAND.mutedRgb)
        .text(`TikTok Profile: @${job.username}`, 50, 190, { align: 'center' });

    doc.fontSize(11).font('Helvetica')
        .fillColor(...BRAND.mutedRgb)
        .text(`Videos after: ${new Date(job.after_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 50, 215, { align: 'center' });

    doc.fontSize(11)
        .text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 50, 235, { align: 'center' });

    // Divider
    doc.moveTo(50, 270).lineTo(pageWidth - 50, 270).strokeColor(...BRAND.primaryRgb).lineWidth(2).stroke();

    // Summary cards
    const cardY = 300;
    const cardWidth = (pageWidth - 140) / 3;
    const cardHeight = 80;
    const cardSpacing = 20;

    const summaryCards = [
        { label: 'Total Videos', value: formatNumber(metrics.totalVideos), sub: `${metrics.eligibleCount} eligible` },
        { label: 'Total Views', value: formatNumber(metrics.totalViews), sub: `${formatNumber(metrics.eligibleViews)} eligible` },
        { label: 'Gross Profit', value: `$${metrics.grossProfit.toFixed(2)}`, sub: `at $${metrics.cpmRate} CPM` }
    ];

    summaryCards.forEach((card, i) => {
        const x = 50 + i * (cardWidth + cardSpacing);
        // Card background
        doc.roundedRect(x, cardY, cardWidth, cardHeight, 8)
            .fillAndStroke('#f8fafc', '#e2e8f0');

        // Card content
        doc.fontSize(10).font('Helvetica')
            .fillColor(...BRAND.mutedRgb)
            .text(card.label, x + 10, cardY + 12, { width: cardWidth - 20 });

        doc.fontSize(20).font('Helvetica-Bold')
            .fillColor(...BRAND.darkRgb)
            .text(card.value, x + 10, cardY + 28, { width: cardWidth - 20 });

        doc.fontSize(9).font('Helvetica')
            .fillColor(...BRAND.mutedRgb)
            .text(card.sub, x + 10, cardY + 55, { width: cardWidth - 20 });
    });

    // Review status section
    const statusY = cardY + cardHeight + 40;
    doc.fontSize(14).font('Helvetica-Bold')
        .fillColor(...BRAND.darkRgb)
        .text('Review Status', 50, statusY);

    const statusCards = [
        { label: 'Approved', value: metrics.approvedCount, color: BRAND.successRgb },
        { label: 'Rejected', value: metrics.rejectedCount, color: BRAND.errorRgb },
        { label: 'Pending', value: metrics.pendingCount, color: BRAND.mutedRgb }
    ];

    const statusCardWidth = (pageWidth - 140) / 3;
    statusCards.forEach((card, i) => {
        const x = 50 + i * (statusCardWidth + cardSpacing);
        const y = statusY + 30;

        doc.roundedRect(x, y, statusCardWidth, 50, 6)
            .fillAndStroke('#f8fafc', '#e2e8f0');

        doc.fontSize(22).font('Helvetica-Bold')
            .fillColor(...card.color)
            .text(String(card.value), x + 10, y + 8, { width: statusCardWidth - 20 });

        doc.fontSize(10).font('Helvetica')
            .fillColor(...BRAND.mutedRgb)
            .text(card.label, x + 10, y + 33, { width: statusCardWidth - 20 });
    });

    // Approved profit highlight
    const profitY = statusY + 120;
    doc.roundedRect(50, profitY, pageWidth - 100, 60, 8)
        .fill('#f0fdf4');

    doc.fontSize(12).font('Helvetica')
        .fillColor(...BRAND.successRgb)
        .text('Approved Profit (eligible views from approved videos only)', 70, profitY + 12);

    doc.fontSize(24).font('Helvetica-Bold')
        .fillColor(...BRAND.successRgb)
        .text(`$${metrics.approvedProfit.toFixed(2)}`, 70, profitY + 30);

    doc.fontSize(10).font('Helvetica')
        .fillColor(...BRAND.mutedRgb)
        .text(`${formatNumber(metrics.approvedEligibleViews)} approved eligible views × $${metrics.cpmRate}/1000`, 250, profitY + 37);

    // CPM info
    const cpmY = profitY + 80;
    doc.fontSize(11).font('Helvetica')
        .fillColor(...BRAND.mutedRgb)
        .text(`CPM Rate: $${metrics.cpmRate}/1,000 views  |  Eligibility Threshold: ≥1,000 views  |  Job ID: #${job.id}`, 50, cpmY, { align: 'center' });
}

function drawVideoDetails(doc, job, videos, cpmRate) {
    const pageWidth = doc.page.width;

    // Section header
    doc.fontSize(18).font('Helvetica-Bold')
        .fillColor(...BRAND.darkRgb)
        .text('Video Details', 50, 50);

    doc.fontSize(10).font('Helvetica')
        .fillColor(...BRAND.mutedRgb)
        .text(`${videos.length} videos from @${job.username}`, 50, 75);

    doc.moveTo(50, 95).lineTo(pageWidth - 50, 95).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // Table header
    let y = 110;
    const cols = {
        num: 50,
        status: 80,
        views: 140,
        likes: 215,
        shares: 280,
        comments: 340,
        profit: 405,
        date: 465
    };

    const drawTableHeader = () => {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(...BRAND.mutedRgb);
        doc.text('#', cols.num, y);
        doc.text('Status', cols.status, y);
        doc.text('Views', cols.views, y);
        doc.text('Likes', cols.likes, y);
        doc.text('Shares', cols.shares, y);
        doc.text('Comments', cols.comments, y);
        doc.text('Profit', cols.profit, y);
        doc.text('Date', cols.date, y);
        y += 18;
        doc.moveTo(50, y).lineTo(pageWidth - 50, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        y += 8;
    };

    drawTableHeader();

    // Table rows
    videos.forEach((video, i) => {
        if (y > doc.page.height - 80) {
            doc.addPage();
            y = 50;
            drawTableHeader();
        }

        const isEligible = video.play_count >= 1000;
        const profit = calculateVideoProfit(video.play_count, cpmRate);

        // Alternating row background
        if (i % 2 === 0) {
            doc.rect(45, y - 3, pageWidth - 90, 18).fill('#f8fafc');
        }

        doc.fontSize(8).font('Helvetica').fillColor(...BRAND.darkRgb);
        doc.text(String(i + 1), cols.num, y);

        // Status badge
        const statusColor = video.review_status === 'approved' ? BRAND.successRgb
            : video.review_status === 'rejected' ? BRAND.errorRgb
            : BRAND.mutedRgb;
        doc.fontSize(7).font('Helvetica-Bold').fillColor(...statusColor);
        doc.text(video.review_status.toUpperCase(), cols.status, y);

        doc.fontSize(8).font('Helvetica').fillColor(...BRAND.darkRgb);
        doc.text(formatNumber(video.play_count), cols.views, y);
        doc.text(formatNumber(video.digg_count), cols.likes, y);
        doc.text(formatNumber(video.share_count), cols.shares, y);
        doc.text(formatNumber(video.comment_count), cols.comments, y);

        // Profit (green if eligible, grey if not)
        if (isEligible) {
            doc.fontSize(8).font('Helvetica-Bold').fillColor(...BRAND.successRgb);
            doc.text(`$${profit.toFixed(2)}`, cols.profit, y);
        } else {
            doc.fontSize(8).font('Helvetica').fillColor(...BRAND.mutedRgb);
            doc.text('—', cols.profit, y);
        }

        // Date
        doc.fontSize(7).font('Helvetica').fillColor(...BRAND.mutedRgb);
        const dateStr = video.created_time_iso ? new Date(video.created_time_iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        doc.text(dateStr, cols.date, y);

        y += 18;
    });
}

function drawWatermark(doc) {
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    doc.save();
    doc.opacity(0.04);
    doc.fontSize(60).font('Helvetica-Bold')
        .fillColor(...BRAND.primaryRgb);

    // Diagonal watermark
    doc.translate(pageWidth / 2, pageHeight / 2);
    doc.rotate(-35, { origin: [0, 0] });
    doc.text('CLIPNIC.COM', -180, -30, { align: 'center' });
    doc.restore();
}

function drawFooter(doc, pageNum, totalPages) {
    const pageWidth = doc.page.width;
    const y = doc.page.height - 35;

    doc.fontSize(8).font('Helvetica')
        .fillColor(...BRAND.mutedRgb)
        .text(`clipnic.com — Campaign Analytics Report`, 50, y)
        .text(`Page ${pageNum} of ${totalPages}`, 50, y, { align: 'right', width: pageWidth - 100 });
}

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return Number(num).toLocaleString();
}

module.exports = { generateReport };
