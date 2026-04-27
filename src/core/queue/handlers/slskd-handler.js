const BaseQueueHandler = require('./base');
const slskdApi = require('../../services/slskd/api');

class SlskdQueueHandler extends BaseQueueHandler {
    constructor() {
        super('Slskd');
        this.maxConcurrent = 3; // Slskd handles up to 3 parallel searches safely
        this.failedAttempts = {}; // Tracks failed users per query
    }

    async pump() {
        while (this.activeSearches < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            this.activeSearches++;
            
            console.log(`[${this.name} Queue] Promoting ${task.query} to active search.`);
            
            this.execute(task)
                .catch(e => console.error(`[${this.name} Queue] Error searching ${task.query}:`, e))
                .finally(() => {
                    this.activeSearches--;
                    this.pump();
                });
        }
    }

    async execute(task) {
        // Logica specifica: Slskd prova fino a X volte.
        // Se `task.canRetry()` è false per slskd, ritorna success: false, retryAllowed: false (passa al fallback)
        if (!task.canRetry()) {
            console.error(`[${this.name} Queue] Task ${task.query} exceeded max attempts (${task.maxAttempts}).`);
            // Reset attempts so next fallback handler has clean slate if needed
            task.attempts = 0; 
            return { success: false, retryAllowed: false, error: 'Exceeded max slskd attempts' };
        }

        task.markAsSearching();
        const failedUsers = this.failedAttempts[task.query] || [];
        const result = await slskdApi.requestDownload(task.name, failedUsers);
        
        if (result.success) {
            task.markAsDownloading(result.user, result.directory);
            return { success: true };
        } else {
            console.warn(`[${this.name} Queue] No results found for ${task.query}, can try again later.`);
            task.markAsError(result.error || 'No valid slskd results');
            // Riprova su slskd (o lo lasciano riprovare il retry manager genitore)
            return { success: false, retryAllowed: true, error: result.error || 'No valid results' };
        }
    }

    recordFailure(task, errorMessage) {
        if (!this.failedAttempts[task.query]) this.failedAttempts[task.query] = [];
        if (task.downloadUser) {
            this.failedAttempts[task.query].push(task.downloadUser);
            slskdApi.deleteDownloadFolder(task.downloadDir, task.downloadUser).catch(e => console.error(e));
        }
        task.progress = 0;
        task.downloadUser = null;
        task.downloadDir = null;
        if (errorMessage) task.errorMessage = errorMessage;
    }
}

module.exports = new SlskdQueueHandler();