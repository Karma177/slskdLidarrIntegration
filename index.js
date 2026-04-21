require('events').EventEmitter.defaultMaxListeners = Infinity;

const express = require('express');
const qbitRoutes = require('./src/server/routes');
const torznabRoutes = require('./src/server/torznab');
const queueManager = require('./src/core/queue');
const config = require('./config');
const axios = require('axios'); // Added to check connections

// Simple in-memory logger to show logs in the Web UI
const logs = [];
const maxLogs = 100;
function interceptConsole(method) {
    const original = console[method];
    console[method] = function (...args) {
        const message = `[${new Date().toISOString()}] [${method.toUpperCase()}] ` + args.join(' ');
        logs.push(message);
        if (logs.length > maxLogs) logs.shift();
        original.apply(console, args);
    };
}
interceptConsole('log');
interceptConsole('warn');
interceptConsole('error');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Log incoming HTTP requests
app.use((req, res, next) => {
    // Skip logging the internal log-fetching endpoint and frequent Lidarr polling to avoid spamming the UI
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
});

// Simple Web UI
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Slskd Download Client - Logs</title>
            <style>
                body { background-color: #1e1e1e; color: #c5c8c6; font-family: monospace; padding: 20px; }
                #logs { background-color: #000; padding: 10px; border-radius: 5px; height: 80vh; overflow-y: auto; white-space: pre-wrap; }
            </style>
            <script>
                async function fetchLogs() {
                    const response = await fetch('/api/logs');
                    const text = await response.text();
                    const logsDiv = document.getElementById('logs');
                    const isScrolledToBottom = logsDiv.scrollHeight - logsDiv.clientHeight <= logsDiv.scrollTop + 1;
                    logsDiv.textContent = text;
                    if (isScrolledToBottom) {
                        logsDiv.scrollTop = logsDiv.scrollHeight;
                    }
                }
                setInterval(fetchLogs, 2000);
                window.onload = fetchLogs;
            </script>
        </head>
        <body>
            <h2>Slskd Download Client - Internal Logs</h2>
            <div id="logs">Loading logs...</div>
        </body>
        </html>
    `);
});

app.get('/api/logs', (req, res) => {
    res.send(logs.join('\n'));
});

// Load qBittorrent mock endpoints
app.use('/api/v2', qbitRoutes);

// Load Torznab mock indexer endpoints
app.use('/torznab', torznabRoutes);

// Ignore favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

const PORT = config.webServer.port;

// Verify connections to dependent services on startup
async function verifyConnections() {
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
}

app.listen(PORT, async () => {
    console.log(`Mock qBittorrent client running on port ${PORT}`);
    await verifyConnections();
    console.log(`Queue manager check interval active.`);
    queueManager.startMonitoring();
});