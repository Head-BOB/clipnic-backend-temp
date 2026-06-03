// ============================================================
// Clipnic Campaign Scraper — Winston Logger
// ============================================================
// In-memory log buffer for Vercel (no filesystem).
// File transports only when running locally.
// ============================================================

const winston = require('winston');
const path = require('path');
const fs = require('fs');

const IS_VERCEL = !!process.env.VERCEL;
const LOG_DIR = path.join(__dirname, '..', 'logs');

// In-memory circular buffer for log viewer (works on Vercel)
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];

const memoryTransport = new winston.transports.Console({
    silent: true // We intercept via a custom format
});

const customFormat = winston.format.printf(({ level, message, timestamp, module, ...meta }) => {
    const mod = module ? `[${module}]` : '';
    const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level.toUpperCase().padEnd(7)} ${mod} ${message}${metaStr}`;
});

// Custom transport that pushes to in-memory buffer
class MemoryTransport extends winston.transports.Console {
    log(info, callback) {
        const line = `${info.timestamp} ${info.level.toUpperCase().replace(/\u001b\[\d+m/g, '').padEnd(7)} ${info.module ? `[${info.module}]` : ''} ${info.message}`;
        logBuffer.push(line);
        if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
        callback();
    }
}

const transports = [
    // Console — colorized
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
            customFormat
        )
    }),
    // In-memory buffer (always active)
    new MemoryTransport({
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            customFormat
        )
    })
];

// File transports only for local dev (Vercel filesystem is read-only)
if (!IS_VERCEL) {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    transports.push(
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'app.log'),
            maxsize: 10 * 1024 * 1024, maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 3
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'scraper.log'),
            maxsize: 10 * 1024 * 1024, maxFiles: 5
        })
    );
}

const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.errors({ stack: true }),
        customFormat
    ),
    transports
});

function createModuleLogger(moduleName) {
    return logger.child({ module: moduleName });
}

function getLogBuffer() {
    return logBuffer;
}

module.exports = { logger, createModuleLogger, getLogBuffer };
