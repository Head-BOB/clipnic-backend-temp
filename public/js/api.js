// ============================================================
// Clipnic Campaign Scraper — API Client
// ============================================================

const API = {
    async post(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    },

    async del(url) {
        const res = await fetch(url, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    },

    async get(url) {
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    },

    startScrape(username, afterDate, cpmRate) {
        return this.post('/api/scrape', { username, afterDate, cpmRate });
    },

    startUrlScrape(urls, cpmRate) {
        return this.post('/api/scrape/urls', { urls, cpmRate });
    },

    startAccountScrape(urls, cpmRate, afterDate, minViews) {
        return this.post('/api/scrape/accounts', { urls, cpmRate, afterDate, minViews });
    },

    getJobStatus(jobId) {
        return this.get(`/api/scrape/${jobId}/status`);
    },

    syncJob(jobId) {
        return this.get(`/api/scrape/${jobId}/sync`);
    },

    getJobs() {
        return this.get('/api/jobs');
    },

    deleteJob(jobId) {
        return this.del(`/api/scrape/${jobId}`);
    },

    refreshApprovedViews() {
        return this.post('/api/scrape/refresh-approved');
    },

    getVideos(jobId, page = 1, limit = 50, filter = 'all') {
        return this.get(`/api/videos/${jobId}?page=${page}&limit=${limit}&filter=${filter}`);
    },

    deleteVideo(videoId) {
        return this.del(`/api/videos/${videoId}`);
    },

    reviewVideo(videoId, status, notes = '') {
        return this.post(`/api/videos/${videoId}/review`, { status, notes });
    },

    getJobSummary(jobId) {
        return this.get(`/api/videos/${jobId}/summary`);
    },

    getGlobalMetrics() {
        return this.get('/api/metrics/global');
    },

    getAuditAnomalies() {
        return this.get('/api/audit/anomalies');
    },

    getGlobalApprovedVideos() {
        return this.get('/api/export/approved-videos-json');
    },

    getGlobalAllVideos() {
        return this.get('/api/export/all-videos-json');
    },

    getLogs(source = 'app', level = 'all', lines = 100) {
        const endpoint = source === 'scraper' ? '/api/logs/scraper' : '/api/logs';
        const params = new URLSearchParams({ lines });
        if (level !== 'all') params.set('level', level);
        return this.get(`${endpoint}?${params}`);
    },

    getExportPdfUrl(jobId) {
        return `/api/videos/${jobId}/export-pdf`;
    }
};
