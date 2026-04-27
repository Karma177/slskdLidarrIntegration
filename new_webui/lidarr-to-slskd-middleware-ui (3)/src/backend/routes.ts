import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import queueManager from './queue.js';
import { getSettings } from './db.js';

const router = express.Router();
const upload = multer();

const mockCategories: any = {};

router.post('/auth/login', (req, res) => {
    res.cookie('SID', 'mock_session_id_1234');
    res.send('Ok.');
});

router.get('/app/webapiVersion', (req, res) => {
    res.send('2.9.3');
});

router.get('/app/preferences', (req, res) => {
    const settings = getSettings();
    res.json({ save_path: settings.downloadPath || '/path/to/downloads' });
});

router.get('/torrents/categories', (req, res) => {
    res.json(mockCategories);
});

router.post('/torrents/createCategory', upload.none(), (req, res) => {
    const categoryName = req.body.category || 'lidarr';
    const settings = getSettings();
    const savePath = req.body.savePath || settings.downloadPath || '/path/to/downloads';
    
    mockCategories[categoryName] = {
        name: categoryName,
        savePath: savePath
    };
    res.send('Ok.');
});

router.get('/torrents/info', (req, res) => {
    const torrents = queueManager.getQueueAsQbitArray();
    res.json(torrents);
});

router.post('/torrents/add', upload.any(), (req, res) => {
    let name = 'Unknown Download';
    let networkQuery = '';
    let hash = '';

    const urls = req.body.urls || '';
    
    const hashMatch = urls.match(/urn:btih:([a-zA-Z0-9]+)/i);
    if (hashMatch && hashMatch[1]) {
        hash = hashMatch[1].toLowerCase();
    }
    
    if (urls.includes('SLSKD-MAGIC_')) {
        const match = urls.match(/SLSKD-MAGIC_([^&]+)/);
        if (match && match[1]) {
            const decoded = decodeURIComponent(match[1]);
            const parts = decoded.split('|||');
            name = parts[0];
            if (parts.length > 1) {
                networkQuery = parts[1];
            } else {
                networkQuery = name;
            }
        }
    } else {
        name = req.body.rename || 'Unknown Download';
        networkQuery = name;
    }

    if (!hash) {
        hash = crypto.createHash('sha1').update(name + Date.now()).digest('hex');
    }

    queueManager.addDownloadTask(hash, { filterQuery: name, networkQuery: networkQuery });
    res.send('Ok.');
});

router.post('/torrents/delete', upload.none(), (req, res) => {
    const hashes = req.body.hashes ? req.body.hashes.split('|') : [];
    queueManager.removeTasks(hashes);
    res.send('Ok.');
});

router.get('/torrents/files', (req, res) => {
    const hash = req.query.hash as string;
    const task = queueManager.tasks.get(hash);
    
    if (!task) return res.json([]);

    const dirParts = task.downloadDir ? task.downloadDir.split(/[\\/]/).filter(p => p.trim() !== '') : [];
    const leafDir = dirParts.length > 0 ? dirParts[dirParts.length - 1] : typeof task.nameObj === 'string' ? task.nameObj : task.nameObj.filterQuery;

    res.json([{
        name: leafDir,
        size: task.totalSize || 10000000,
        progress: task.progress,
        priority: 1,
        is_seed: false,
        piece_range: [0, 0],
        availability: task.progress
    }]);
});

router.get('/torrents/properties', (req, res) => {
    const hash = req.query.hash as string;
    const task = queueManager.tasks.get(hash);
    
    if (!task) return res.status(404).send('Not found');

    const remainingBytes = (task.totalSize || 0) - (task.downloadedSize || 0);
    let dlspeed = 0;
    let eta = 8640000;

    if (task.status === 'downloading' && task.totalSize > 0 && task.downloadStartTime) {
        dlspeed = task.downloadedSize > 0 ? (task.downloadedSize / ((Date.now() - task.downloadStartTime) / 1000)) : 1024 * 1024;
        eta = dlspeed > 0 ? remainingBytes / dlspeed : 8640000;
    }

    const settings = getSettings();
    let basePath = settings.downloadPath || '/app/data/downloads';
    if (!basePath.startsWith('/') && !/^[a-zA-Z]:/.test(basePath)) {
        basePath = '/' + basePath;
    }

    res.json({
        save_path: basePath,
        creation_date: Math.floor((task.downloadStartTime || Date.now()) / 1000),
        addition_date: Math.floor((task.downloadStartTime || Date.now()) / 1000),
        completion_date: task.progress === 1 ? Math.floor(Date.now() / 1000) : -1,
        total_size: task.totalSize || 10000000,
        total_downloaded: task.downloadedSize || 0,
        total_uploaded: 0,
        up_limit: -1,
        dl_limit: -1,
        time_elapsed: Math.floor((Date.now() - (task.downloadStartTime || Date.now())) / 1000),
        seeding_time: task.progress === 1 ? 1 : 0,
        share_ratio: 0,
        created_by: 'slskd (via Bridge)',
        dl_speed_avg: Math.floor(dlspeed),
        dl_speed: Math.floor(dlspeed),
        up_speed_avg: 0,
        up_speed: 0,
        eta: Math.floor(eta),
        peers: 1,
        peers_total: 1,
        seeds: 1,
        seeds_total: 1,
        piece_size: 1048576,
        pieces_have: task.progress === 1 ? 1 : 0,
        pieces_num: 1,
        reannounce: 0,
        last_seen: Math.floor(Date.now() / 1000)
    });
});

export default router;
