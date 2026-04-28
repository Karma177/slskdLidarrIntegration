const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const queueManager = require('../core/queue');
const dbManager = require('../core/db/db-access');

const router = express.Router();
const upload = multer();

// Mock storage for categories
const mockCategories = {};

/**
 * Handles mock authentication for qBittorrent API.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleAuthLogin(req, res) {
    res.cookie('SID', 'mock_session_id_1234');
    res.send('Ok.');
}

/**
 * Returns a mocked web API version.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleAppWebapiVersion(req, res) {
    res.send('2.9.3');
}

/**
 * Returns mocked application preferences.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleAppPreferences(req, res) {
    res.json({ save_path: '/path/to/downloads' });
}

/**
 * Returns the currently stored mock categories.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleGetCategories(req, res) {
    res.json(mockCategories);
}

/**
 * Simulates the creation of a new category.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleCreateCategory(req, res) {
    const categoryName = req.body.category || 'lidarr';
    const savePath = req.body.savePath || '/path/to/downloads';
    
    mockCategories[categoryName] = {
        name: categoryName,
        savePath: savePath
    };
    
    res.send('Ok.');
}

/**
 * Returns the current download queue formatted as a qBittorrent torrent list.
 * Lidarr polls this endpoint to check download progress.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleGetTorrentsInfo(req, res) {
    const torrents = queueManager.getQueueAsQbitArray();
    res.json(torrents);
}

/**
 * Handles adding a new download task. Lidarr calls this with a magnet link or torrent file.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleAddTorrent(req, res) {
    let name = 'Unknown Download'; // Fallback broad filter
    let networkQuery = '';         // Fallback slim query
    let hash = '';

    const urls = req.body.urls || '';
    
    // Extract the infohash from the magnet link. Lidarr uses this hash to track the download.
    const hashMatch = urls.match(/urn:btih:([a-zA-Z0-9]+)/i);
    if (hashMatch && hashMatch[1]) {
        hash = hashMatch[1].toLowerCase();
    }
    
    if (urls.includes('SLSKD-MAGIC_')) {
        // Some clients encode ampersands as &amp; inside XML attributes. Be tolerant
        // and accept either raw & or the entity. Also log the raw payload for debugging.
        console.log('[QBI] Raw incoming magnet/urls payload:', urls);

        // Match SLSKD-MAGIC_ up to the next parameter separator. Accept both '&' and '&amp;'
        const match = urls.match(/SLSKD-MAGIC_([^&]+?)(?:&|&amp;|$)/i);
        if (match && match[1]) {
            // Replace HTML encoded ampersands if present, then URI-decode safely
            let captured = match[1].replace(/&amp;/gi, '&');
            try {
                const decoded = decodeURIComponent(captured);
                // Separate the broad filter from the strict network query (FILTER|||NETWORK)
                const parts = decoded.split('|||');
                name = (parts[0] || name).trim();
                if (parts.length > 1) {
                    networkQuery = (parts[1] || name).trim();
                } else {
                    networkQuery = name;
                }
            } catch (e) {
                // If decodeURIComponent fails, fall back to the raw captured string
                console.warn('[QBI] Failed to decode SLSKD payload, using raw captured value:', e.message);
                const parts = captured.split('|||');
                name = (parts[0] || name).trim();
                networkQuery = parts[1] ? parts[1].trim() : name;
            }
            console.log(`[QBI] Parsed SLSKD payload. Name: "${name}" NetworkQuery: "${networkQuery}"`);
        } else {
            // No match — log for diagnosis
            console.warn('[QBI] SLSKD-MAGIC marker present but payload could not be parsed. Payload:', urls);
        }
    } else {
        // Fallback if no magic payload is found
        name = req.body.rename || 'Unknown Download';
        networkQuery = name;
    }

    if (!hash) {
        hash = crypto.createHash('sha1').update(name + Date.now()).digest('hex');
    }

    console.log(`[QBI] Captured download. Hash: ${hash} Net-Query: "${networkQuery}", Full-Filter: "${name}"`);
    queueManager.addDownloadTask(hash, { filterQuery: name, networkQuery: networkQuery });
    res.send('Ok.');
}

/**
 * Handles torrent deletion requests. Stops tracking and removes associated downloads.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleDeleteTorrent(req, res) {
    const hashes = req.body.hashes ? req.body.hashes.split('|') : [];
    queueManager.removeTasks(hashes);
    res.send('Ok.');
}

/**
 * Returns a mocked file list for a specific torrent. 
 * Lidarr polls this to inspect completed contents before importing.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleGetTorrentFiles(req, res) {
    const hash = req.query.hash;
    const task = queueManager.tasks.get(hash);
    
    if (!task) {
        return res.json([]);
    }

    const dirParts = task.downloadDir ? task.downloadDir.split(/[\\/]/).filter(p => p.trim() !== '') : [];
    const leafDir = dirParts.length > 0 ? dirParts[dirParts.length - 1] : typeof task.name === 'string' ? task.name : task.name.filterQuery;

    // Tell Lidarr that the requested files are located inside a targeted folder.
    // Lidarr will append this 'name' to the 'save_path' mapped in the task.
    res.json([{
        name: leafDir,
        size: task.totalSize || 10000000,
        progress: task.progress,
        priority: 1,
        is_seed: false,
        piece_range: [0, 0],
        availability: task.progress
    }]);
}

/**
 * Returns detailed properties for a specific torrent to satisfy strict indexing checks.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleGetTorrentProperties(req, res) {
    const hash = req.query.hash;
    const task = queueManager.tasks.get(hash);
    
    if (!task) {
        return res.status(404).send('Not found');
    }

    const remainingBytes = (task.totalSize || 0) - (task.downloadedSize || 0);
    let dlspeed = 0;
    let eta = 8640000;

    if (task.status === 'downloading' && task.totalSize > 0) {
        dlspeed = task.downloadedSize > 0 ? (task.downloadedSize / ((Date.now() - task.downloadStartTime) / 1000)) : 1024 * 1024;
        eta = dlspeed > 0 ? remainingBytes / dlspeed : 8640000;
    }

    let basePath = dbManager.getSetting('slskd_download_dir') || '/app/data/downloads';
    if (!basePath.startsWith('/') && !/^[a-zA-Z]:/.test(basePath)) {
        basePath = '/' + basePath;
    }

    res.json({
        save_path: basePath,
        creation_date: Math.floor(task.downloadStartTime / 1000) || Math.floor(Date.now() / 1000),
        addition_date: Math.floor(task.downloadStartTime / 1000) || Math.floor(Date.now() / 1000),
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
}

// --- Route Definitions ---

// Mock Authentication
router.post('/auth/login', handleAuthLogin);

// Server State / Capabilities
router.get('/app/webapiVersion', handleAppWebapiVersion);
router.get('/app/preferences', handleAppPreferences);

// Categories
router.get('/torrents/categories', handleGetCategories);
router.post('/torrents/createCategory', handleCreateCategory);

// Torrents Information & Manipulation
router.get('/torrents/info', handleGetTorrentsInfo);
router.post('/torrents/add', upload.any(), handleAddTorrent);
router.post('/torrents/delete', handleDeleteTorrent);
router.get('/torrents/files', handleGetTorrentFiles);
router.get('/torrents/properties', handleGetTorrentProperties);

module.exports = router;