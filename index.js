require('events').EventEmitter.defaultMaxListeners = Infinity;

const express = require('express');
const axios = require('axios');
const path = require('path');
const qbitRoutes = require('./src/server/routes');
const torznabRoutes = require('./src/server/torznab');
const queueManager = require('./src/core/queue');
const logs = [];
const maxLogs = 1000;

// Read runtime configuration from the DB (populated at first-run from env/docker)
const dbManager = require('./src/core/db/db-access');
const PORT = parseInt(dbManager.getSetting('port') || process.env.PORT || '8080', 10);
const app = express();

/**
 * Intercepts standard console methods to store logs in memory for the internal Web UI.
 * @param {string} method - The console method to intercept (e.g., 'log', 'warn', 'error').
 */
const interceptConsole = (method) => {
    const original = console[method];
    console[method] = (...args) => {
        const message = `[${new Date().toISOString()}] [${method.toUpperCase()}] ${args.join(' ')}`;
        logs.push(message);
        if (logs.length > maxLogs) logs.shift();
        original.apply(console, args);
    };
};

interceptConsole('log');
interceptConsole('warn');
interceptConsole('error');


/**
 * Middleware to log incoming HTTP requests, ignoring frequent polling endpoints.
 * @param {express.Request} req - The Express request object.
 * @param {express.Response} res - The Express response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const requestLogger = (req, res, next) => {
    const ignoredPaths = [
        '/api/logs',
        '/api/v2/torrents/info',
        '/api/v2/sync/maindata',
        '/api/v2/app/webapiVersion',
        '/api/v2/app/preferences',
        '/api/v2/torrents/categories',
        '/api/v2/torrents/createCategory',
        '/favicon.ico'
    ];

    if (!ignoredPaths.includes(req.path)) {
        console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
    }
    next();
};

/**
 * Endpoint to retrieve the in-memory array of logs as plain text.
 * @param {express.Request} req - The Express request object.
 * @param {express.Response} res - The Express response object.
 */
const serveLogs = (req, res) => {
    res.json(logs);
};

/**
 * Bypasses processing for favicon requests.
 * @param {express.Request} req - The Express request object.
 * @param {express.Response} res - The Express response object.
 */
const ignoreFavicon = (req, res) => res.status(204).end();

/**
 * Verifies HTTP connectivity to external required services (Lidarr and Slskd) upon boot.
 * @returns {Promise<void>}
 */
const formatError = (err) => {
    if (err.response) return `HTTP ${err.response.status} - ${err.response.statusText}`;
    let msg = err.message || err.toString();
    const errors = err.errors || (err.cause && err.cause.errors) || [];
    if (Array.isArray(errors) && errors.length > 0) {
        return `${msg} - Details: ${errors.map(e => e.message || e).join(', ')}`;
    }
    if (err.cause) return `${msg} (Cause: ${err.cause.message || err.cause})`;
    return msg;
};

const verifyConnections = async () => {
    console.log(`[BOOT] Verifying connections to services...`);
    try {
        const lidarrApi = dbManager.getApi('lidarr') || {};
        await axios.get(`${lidarrApi.api_url}/system/status`, {
            headers: { 'X-Api-Key': lidarrApi.api_key },
            timeout: 5000
        });
        console.log(`[BOOT] [OK] Successfully connected to Lidarr: ${lidarrApi.api_url}`);
    } catch (err) {
        const lidarrApi = dbManager.getApi('lidarr') || {};
        console.error(`[BOOT] [FATAL ERROR] Unable to contact Lidarr at ${lidarrApi.api_url}. Error: ${formatError(err)}`);
    }

    try {
        const slskdApi = dbManager.getApi('slskd') || {};
        await axios.get(`${slskdApi.api_url}/api/v0/application/info`, {
            headers: { 'X-API-KEY': slskdApi.api_key },
            timeout: 5000
        });
        console.log(`[BOOT] [OK] Successfully connected to Slskd API: ${slskdApi.api_url}`);
    } catch (err) {
        const slskdApi = dbManager.getApi('slskd') || {};
        console.error(`[BOOT] [FATAL ERROR] Unable to contact Slskd at ${slskdApi.api_url}. Error: ${formatError(err)}`);
    }
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(requestLogger);

const webUiApi = require('./src/server/webui-api');

app.use(express.static(path.join(__dirname, 'src', 'core', 'ui')));

app.get('/api/logs', serveLogs);
app.use('/api', webUiApi); // Aggiunge /api/queue, /api/history ecc per la UI.
app.get('/favicon.ico', ignoreFavicon);

app.use('/api/v2', qbitRoutes);
app.use('/torznab', torznabRoutes);

app.listen(PORT, async () => {
    console.log(`[BOOT] Mock qBittorrent client running on port ${PORT}`);
    await verifyConnections();
    console.log(`[BOOT] Queue manager check interval active.`);
    queueManager.startMonitoring();
});
