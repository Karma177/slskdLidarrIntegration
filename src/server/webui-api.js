const express = require('express');
const dbManager = require('../core/db/db-access');
const queueManager = require('../core/queue');

const router = express.Router();

/**
 * Endpoint per ritornare la coda in formato compatibile per la Web UI.
 */
router.get('/queue', (req, res) => {
    const items = Array.from(queueManager.tasks.values()).map(t => ({
        hash: t.hash,
        query: t.query,
        status: t.status,
        progress: t.progress,
        errorMessage: t.errorMessage,
        downloadedSize: t.downloadedSize,
        totalSize: t.totalSize
    }));
    res.json(items);
});

/**
 * Endpoint per riprovare un download fallito
 */
router.post('/queue/:hash/retry', (req, res) => {
    const task = queueManager.tasks.get(req.params.hash);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    
    console.log(`[API] Utente ha richiesto il retry della traccia: ${task.query}`);
    task.currentQueueHandlerIndex = 0; // Ripristina all'inizio del fallback order
    task.attempts = 0; 
    queueManager.executeSearchWithFallback(task); // Re-immetti nella coda search
    
    res.json({ success: true });
});

/**
 * Endpoint per rimuovere un download fallito o completato
 */
router.delete('/queue/:hash', (req, res) => {
    const task = queueManager.tasks.get(req.params.hash);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Registra nello storico come fallito/rimosso prima di cancellare
    dbManager.addHistory(task.query, '', '', 'User', 'errored', 'Removed from queue by user');
    queueManager.tasks.delete(req.params.hash);
    console.log(`[API] Utente ha rimosso la traccia dalla coda: ${task.query}`);

    res.json({ success: true });
});

/**
 * Ritorna lo storico dei download con i filtri previsti dalla testata
 */
router.get('/history', (req, res) => {
    const filter = req.query.filter || 'all';
    let history = dbManager.getHistory();
    
    if (filter === 'success') {
        history = history.filter(h => h.status === 'completed');
    } else if (filter === 'failed') {
        history = history.filter(h => h.status === 'errored');
    }
    
    // Mappa al formato atteso dalla UI
    const mapped = history.map(h => ({
        id: h.id,
        query: h.title, // La history salva 'title', nella front-end è usato 'query'
        status: h.status === 'completed' ? 'success' : 'failed',
        timestamp: h.added_at,
        errorMessage: h.error_message
    }));
    
    res.json(mapped);
});

/**
 * Endpoint per get e set dei settings della pagina Configuration
 */
router.get('/settings', (req, res) => {
    // Mappiamo i campi del DB SQLite nei campi testuali previsti dalla Web UI React
    res.json({
        primaryDownloader: (dbManager.getSetting('fallback_order') || '').split(',')[0],
        fallbackDownloader: (dbManager.getSetting('fallback_order') || '').split(',')[1] || 'none',
        queryFormat: dbManager.getSetting('query_template') || '{artist} {album}',
        qualityPreferences: dbManager.getSetting('quality_preferences') || 'flac',
        downloadPath: dbManager.getSetting('slskd_download_dir') || '/downloads',
        importTimeout: dbManager.getSetting('import_timeout') || '120000',
        
        lidarrApiUrl: (dbManager.getApi('lidarr') || {}).api_url || '',
        lidarrApiKey: (dbManager.getApi('lidarr') || {}).api_key || '',
        slskdApiUrl: (dbManager.getApi('slskd') || {}).api_url || '',
        slskdApiKey: (dbManager.getApi('slskd') || {}).api_key || '',
    });
});

router.post('/settings', (req, res) => {
    const data = req.body;
    
    if (data.primaryDownloader || data.fallbackDownloader) {
        // Ricostruiamo la stringa "slskd,tidal,qobuz,ecc" a spanne se la UI salva un primary/fallback fisso
        const active = [data.primaryDownloader];
        if (data.fallbackDownloader && data.fallbackDownloader !== 'none') {
            active.push(data.fallbackDownloader);
        }
        dbManager.setSetting('fallback_order', active.join(','));
    }
    
    if (data.queryFormat) dbManager.setSetting('query_template', data.queryFormat);
    if (data.qualityPreferences) dbManager.setSetting('quality_preferences', data.qualityPreferences);
    if (data.downloadPath) dbManager.setSetting('slskd_download_dir', data.downloadPath);
    if (data.importTimeout) dbManager.setSetting('import_timeout', data.importTimeout);
    
    if (data.lidarrApiUrl !== undefined || data.lidarrApiKey !== undefined) {
        dbManager.updateApi('lidarr', data.lidarrApiKey, data.lidarrApiUrl);
    }
    if (data.slskdApiUrl !== undefined || data.slskdApiKey !== undefined) {
        dbManager.updateApi('slskd', data.slskdApiKey, data.slskdApiUrl);
    }

    console.log(`[API] Settings aggiornati dalla Web UI.`);
    res.json({ success: true });
});

module.exports = router;