require('events').EventEmitter.defaultMaxListeners = Infinity;

const express = require('express');
const axios = require('axios');
const path = require('path');
const qbitRoutes = require('./src/server/routes');
const torznabRoutes = require('./src/server/torznab');
const queueManager = require('./src/core/queue');
const config = require('./config');

const logs = [];
const maxLogs = 1000;

const PORT = config.webServer.port;

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
    res.send(logs.join('\n'));
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
const verifyConnections = async () => {
    console.log(`[BOOT] Verifying connections to services...`);
    try {
        await axios.get(`${config.lidarr.apiUrl}/system/status`, {
            headers: { 'X-Api-Key': config.lidarr.apiKey },
            timeout: 5000
        });
        console.log(`[BOOT] [OK] Successfully connected to Lidarr: ${config.lidarr.apiUrl}`);
    } catch (err) {
        console.error(`[BOOT] [FATAL ERROR] Unable to contact Lidarr at ${config.lidarr.apiUrl}. Error: ${err.message}`);
    }

    try {
        await axios.get(`${config.slskd.apiUrl}/api/v0/application/info`, {
            headers: { 'X-API-KEY': config.slskd.apiKey },
            timeout: 5000
        });
        console.log(`[BOOT] [OK] Successfully connected to Slskd API: ${config.slskd.apiUrl}`);
    } catch (err) {
        console.error(`[BOOT] [FATAL ERROR] Unable to contact Slskd at ${config.slskd.apiUrl}. Error: ${err.message}`);
    }
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(requestLogger);

app.use(express.static(path.join(__dirname, 'src', 'webui')));

app.get('/api/logs', serveLogs);
app.get('/favicon.ico', ignoreFavicon);

app.use('/api/v2', qbitRoutes);
app.use('/torznab', torznabRoutes);


app.listen(PORT, async () => {
    console.log(`[BOOT] Mock qBittorrent client running on port ${PORT}`);
    await verifyConnections();
    console.log(`[BOOT] Queue manager check interval active.`);
    queueManager.startMonitoring();
});
