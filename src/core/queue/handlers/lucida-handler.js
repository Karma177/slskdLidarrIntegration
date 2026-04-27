const BaseQueueHandler = require('./base');
const lucidaManager = require('../../services/lucida/lucida-manager');
const dbManager = require('../../db/db-access');

class LucidaQueueHandler extends BaseQueueHandler {
    constructor(serviceName) {
        super(serviceName); // il parametro ora passa 'Tidal', 'Qobuz', 'Spotify'
        this.maxConcurrent = 1; 
        this.serviceName = serviceName.toLowerCase();
    }

    async execute(task) {
        // Lucida non ha "retry". Se fallisce 1 volta al massimo non c'è traccia o token scaduto o errore server.
        task.markAsSearching();

        const searchResult = await lucidaManager.search(task.query, this.serviceName);

        
        if (searchResult.success && searchResult.results.length > 0) {
            // Seleziona la prima traccia (di solito la migliore per rilevanza / alta qualità)
            const track = searchResult.results[0];
            const outputDir = dbManager.getSetting('slskd_download_dir') || '/downloads';
            
            task.markAsDownloading(`[${this.name}]`, outputDir);
            
            // Lucida download block (potenzialmente lento per file grossi, quindi usa stream diretti o wait passivo)
            const downloadResult = await lucidaManager.download(track.url, outputDir);
            
            if (downloadResult.success) {
                task.markAsCompleted();
                dbManager.addHistory(task.name, task.query, '', this.name, 'completed');
                return { success: true };
            } else {
                task.markAsError(downloadResult.error || `Failed to download from ${this.name}`);
                dbManager.addHistory(task.name, task.query, '', this.name, 'errored', downloadResult.error);
                return { success: false, retryAllowed: false, error: downloadResult.error };
            }
        } else {
            task.markAsError(searchResult.error || `Nessun risultato compatibile trovato su ${this.name}.`);
            return { success: false, retryAllowed: false, error: searchResult.error }; // No retry for missing lucida tracks.
        }
    }
}

module.exports = LucidaQueueHandler;