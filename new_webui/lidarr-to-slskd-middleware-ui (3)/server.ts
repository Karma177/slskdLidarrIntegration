import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = Infinity;

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { getSettings, saveSettings, getHistory, addToHistory, clearHistory } from './src/backend/db.js';
import qbitRoutes from './src/backend/routes.js';
import torznabRoutes from './src/backend/torznab.js';
import queueManager from './src/backend/queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logs: string[] = [];
const maxLogs = 1000;

const interceptConsole = (method: 'log' | 'warn' | 'error') => {
    const original = console[method];
    console[method] = (...args: any[]) => {
        const message = `[${new Date().toISOString()}] [${method.toUpperCase()}] ${args.join(' ')}`;
        logs.push(message);
        if (logs.length > maxLogs) logs.shift();
        original.apply(console, args);
    };
};

interceptConsole('log');
interceptConsole('warn');
interceptConsole('error');

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// Internal UI APIs
app.get('/api/logs', (req, res) => {
    res.json(logs);
});

app.get('/api/settings', (req, res) => {
    res.json(getSettings());
});

app.post('/api/settings', (req, res) => {
    saveSettings(req.body);
    res.json({ success: true });
});

app.get('/api/history', (req, res) => {
    const filter = req.query.filter as string;
    res.json(getHistory(filter));
});

app.delete('/api/history', (req, res) => {
    clearHistory();
    res.json({ success: true });
});

app.get('/api/queue', (req, res) => {
    const active = queueManager.getQueueAsUIArray();
    res.json(active);
});

app.delete('/api/queue/:hash', (req, res) => {
    queueManager.removeTasks([req.params.hash]);
    res.json({ success: true });
});

app.post('/api/queue/:hash/retry', (req, res) => {
    const hash = req.params.hash;
    const task = queueManager.tasks.get(hash);
    if (task) {
        task.status = 'downloading';
        task.progress = 0;
        task.errorMessage = '';
        queueManager.tasks.set(hash, task);
    }
    res.json({ success: true });
});

// Mock Endpoints for lidarr
app.use('/api/v2', qbitRoutes);
app.use('/torznab', torznabRoutes);

async function startServer() {
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`[BOOT] Server listening on port ${PORT}`);
        queueManager.startMonitoring();
    });
}

startServer();
