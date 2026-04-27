const slskdApi = require('./services/slskd/api');
const lidarrBridge = require('./services/lidarr/lidarr-bridge');
const dbManager = require('./db/db-access');
const Mutex = require('./utils/mutex');
const DownloadTask = require('./DownloadTask');

/**
 * Manages the entire lifecycle of download tasks, including queuing, polling states,
 * interacting with the Slskd API, and updating Lidarr's state.
 */
class QueueManager {
    static handlers = {
        'slskd': require('./queue/handlers/slskd-handler')
    };

    /**
     * Initializes the QueueManager.
     */
    constructor() {
        this.tasks = new Map(); // hash -> DownloadTask
        this.failedAttempts = {}; // query -> array of users that failed
        this.activeSearches = 0;
        this.searchQueue = [];
        this.pumpMutex = new Mutex(); // Mutex per prevenire overlap
        
        const LucidaQueueHandler = require('./queue/handlers/lucida-handler');
        QueueManager.handlers['tidal'] = new LucidaQueueHandler('tidal');
        QueueManager.handlers['qobuz'] = new LucidaQueueHandler('qobuz');
        QueueManager.handlers['spotify'] = new LucidaQueueHandler('spotify');
    }

    /**
     * Enqueues a search task to respect Slskd's search concurrency limits.
     * @param {DownloadTask} task - The task to search for.
     */
    enqueueSearch(task) {
        // Evitiamo di accodare più volte lo stesso task se è già in attesa
        if (!this.searchQueue.find(t => t.hash === task.hash)) {
            this.searchQueue.push(task);
            console.log(`[Queue] Task pushed to search queue: ${task.query}. (Queue position: ${this.searchQueue.length}, Active: ${this.activeSearches}/3)`);
            this.pumpQueue();
        } else {
            console.log(`[Queue] Task ${task.query} is already in the search queue. Ignoring duplicate enqueue.`);
        }
    }

    /**
     * Processes the up to 3 searches iteratively acting as a worker pool.
     * Uses an async Mutex to synchronize execution and completely eliminate race conditions.
     */
    async pumpQueue() {
        await this.pumpMutex.acquire();

        try {
            while (this.activeSearches < 3 && this.searchQueue.length > 0) {
                const task = this.searchQueue.shift();
                this.activeSearches++;

                console.log(`[Queue] Promoting ${task.query} to active search. (Active: ${this.activeSearches}/3, Remaining in queue: ${this.searchQueue.length})`);
                if (this.searchQueue.length > 0) {
                    console.log(`[Queue] Pending searches in queue (${this.searchQueue.length}):`);
                    this.searchQueue.forEach((t, i) => console.log(`        #${i + 1} - ${t.query}`));
                }

                // Immediately launch search asynchronously, without awaiting, so the while loop can dispatch up to 3
                this.executeSearchWithFallback(task)
                    .catch(e => console.error(`[Queue] Error searching ${task.query}:`, e))
                    .finally(() => {
                        this.activeSearches--;
                        this.pumpQueue(); 
                    });
            }
        } finally {
            this.pumpMutex.release();
        }
    }

    /**
     * Formats the current tasks into an array compatible with the qBittorrent API v2.
     * @returns {Array<Object>} List of mocked torrent objects.
     */
    getQueueAsQbitArray() {
        return Array.from(this.tasks.values()).map(task => this._mapTaskToQbit(task));
    }

    /**
     * Transforms an internal DownloadTask into a qBittorrent torrent object.
     * @param {DownloadTask} task - The task to transform.
     * @returns {Object} The formatted qBittorrent-like object.
     * @private
     */
    _mapTaskToQbit(task) {
        let qbitState = 'downloading';
        let leafDir = '';
        const dirParts = task.downloadDir ? task.downloadDir.split(/[\\/]/).filter(p => p.trim() !== '') : [];
        leafDir = dirParts.length > 0 ? dirParts[dirParts.length - 1] : typeof task.name === 'string' ? task.name : task.name.filterQuery;

        if (task.status === 'completed' && task.progress === 1) {
            qbitState = 'pausedUP';
        } else if (task.status === 'failed' || task.status === 'error') {
            // Se impostiamo 'error', Lidarr fissa il messaggio.
            // Impostiamo `pausedDL` così Lidarr lo mette in Arancione (Warning/Paused),
            // e alteriamo radicalmente il nome del torrent così che l'errore balzi subito all'occhio.
            qbitState = 'pausedDL';
            leafDir = `[SLSKD ERROR: ${task.errorMessage || 'Failed'}] ${leafDir}`;
        }

        // Approximate ETA calculation if actively downloading (default to 86400s if stalled)
        const remainingBytes = (task.totalSize || 0) - (task.downloadedSize || 0);
        let eta = 8640000;
        let dlspeed = 0;
        if (task.status === 'downloading' && task.totalSize > 0) {
            // Calculate dynamic download speed
            dlspeed = task.downloadedSize > 0 ? (task.downloadedSize / ((Date.now() - task.downloadStartTime) / 1000)) : 1024 * 1024;
            eta = dlspeed > 0 ? remainingBytes / dlspeed : 8640000;
        }

        let basePath = dbManager.getSetting('slskd_download_dir') || '/app/data/downloads';
        if (!basePath.startsWith('/') && !/^[a-zA-Z]:/.test(basePath)) {
            basePath = '/' + basePath;
        }

        return {
            hash: task.hash,
            name: leafDir,
            size: task.totalSize || 10000000, 
            downloaded: task.downloadedSize || 0,
            progress: typeof task.progress === 'number' ? task.progress : 0,
            state: qbitState,
            save_path: basePath,
            eta: Math.floor(eta),
            dlspeed: Math.floor(dlspeed),
            upspeed: 0,
            category: 'lidarr',
            tags: 'slskd',
            tracker: task.errorMessage || 'slskd'
        };
    }

    /**
     * Adds a new download task to the queue and triggers the search.
     * @param {string} hash - The unique hash to identify the task.
     * @param {Object} nameObj - Contains query strings mapped from Lidarr.
     */
    async addDownloadTask(hash, nameObj) {
        if (this.tasks.has(hash)) return;

        const task = new DownloadTask(hash, nameObj);
        this.tasks.set(hash, task);
        this.enqueueSearch(task);
    }

    async executeSearchWithFallback(task) {
        const fallbacks = task.fallbackOrder; // Es. ['slskd', 'lucida', 'tidal'] ecc
        const currentIndex = task.currentQueueHandlerIndex;

        // Se abbiamo finito tutti i tentativi e tutti i provider... 
        if (currentIndex >= fallbacks.length) {
            console.error(`[Queue] Task ${task.query} has exhausted all fallback options. Marking as failed.`);
            task.markAsFailed('Exceeded all fallback handlers. No usable results found.');
            return;
        }

        const providerName = fallbacks[currentIndex];
        console.log(`[Queue] Inviando task ${task.query} al provider: ${providerName} (Fallback: ${currentIndex + 1}/${fallbacks.length})`);

        // Otteniamo il gestore corrispondente a questo nome
        const handler = QueueManager.handlers[providerName];
        if (!handler) {
            console.warn(`[Queue] Provider sconosciuto "${providerName}". Passo al prossimo fallback.`);
            task.currentQueueHandlerIndex++;
            return this.executeSearchWithFallback(task);
        }

        try {
            // "Esegue" o "Accoda" sul gestore specifico
            // Nel tuo design, passiamo la chiamata al gestore. E lui ritornerà un esito o metterà in loop.
            const result = await handler.execute(task);

            if (result.success) {
                // Il gestore ha accettato il file / o completato il download/scaricamento ed è visibile a Lidarr
                console.log(`[Queue] [${providerName}] ha gestito con successo il task ${task.query}`);
            } else {
                // Il gestore non è in grado di procedere con la traccia *specifica* per mancati retry o assenza di fondi. 
                if (result.retryAllowed) {
                    console.log(`[Queue] [${providerName}] Tentativo fallito, ma retry consentito. Riproviamo...`);
                    // Rimandiamo in coda nello stesso handler (ad es Slskd al retry 2 o 3)
                    this.recordFailureAndRetry(task, result.error); 
                } else {
                    console.log(`[Queue] [${providerName}] Impossibile soddisfare task. Passaggio a fallback successivo.`);
                    task.currentQueueHandlerIndex++;
                    task.attempts = 0; // reset tenta per un eventuale altro servizio 
                    return this.executeSearchWithFallback(task);
                }
            }
        } catch (error) {
            console.error(`[Queue] [${providerName}] Critical Handler Error:`, error.message);
            // Errore server o API; andiamo al fallback successivo
            task.currentQueueHandlerIndex++;
            return this.executeSearchWithFallback(task);
        }
    }

    /**
     * Clears given task hashes from memory, kills active timeouts, and stops associated Slskd downloads.
     * @param {string[]} hashes - An array of unique task hashes to remove.
     */
    removeTasks(hashes) {
        hashes.forEach(hash => {
            const task = this.tasks.get(hash);
            if (task) {
                if (task.downloadUser && task.downloadDir) {
                    slskdApi.deleteDownloadFolder(task.downloadDir, task.downloadUser).catch(e => console.error(e));
                }
                
                if (task.importTimer) {
                    clearTimeout(task.importTimer);
                }

                if (task.query && this.failedAttempts[task.query]) {
                    delete this.failedAttempts[task.query];
                }
                
                this.tasks.delete(hash);
            }
        });
    }

    /**
     * Starts the continuous background polling loop that updates downloading states
     * and monitors Lidarr import processes.
     */
    startMonitoring() {
        const checkLoop = async () => {
            for (const [hash, task] of this.tasks.entries()) {
                if (task.status === 'downloading') {
                    await this._processDownloadingTask(task);
                } else if (task.status === 'completed') {
                    await this._processCompletedTask(task);
                }
            }
            
            await this.enforceQueueConsistency();
            
            setTimeout(checkLoop, 5000);
        };
        
        setTimeout(checkLoop, 5000);
    }

    /**
     * Handles inspecting active downloads through the Slskd API.
     * @param {DownloadTask} task - The downloading task object.
     * @private
     */
    async _processDownloadingTask(task) {
        const status = await slskdApi.checkDownloadStatus(task);
        task.progress = status.progress;
        task.totalSize = status.totalBytes;
        task.downloadedSize = status.downloadedBytes;
        
        if (status.failed) {
            // Allow one retry per specifically failed file before giving up on the peer
            const filesToRetry = (status.failedFiles || []).filter(f => !task.retriedFiles.has(f.filename));
            
            if (filesToRetry.length > 0) {
                console.log(`[Queue] Task for ${task.query} has ${filesToRetry.length} failed files. Attempting one retry...`);
                filesToRetry.forEach(f => task.retriedFiles.add(f.filename));
                
                const retrySuccess = await slskdApi.retryDownloadFiles(task.downloadUser, filesToRetry);
                
                // Allow the task to keep downloading on success
                if (retrySuccess) {
                    return; 
                }
            }

            console.warn(`[Queue] Task for ${task.query} reported an error or user ${task.downloadUser} rejected the queue. Flagging as error and retrying search.`);
            this.recordFailureAndRetry(task, `User ${task.downloadUser} rejected or timed out`);
        } else if (status.completed && !task.importTimer) {
            console.log(`[Queue] Album/Track for "${task.query}" successfully downloaded! Notifying Lidarr with 'pausedUP' state to start import.`);
            task.markAsCompleted();
            this.startImportTimeout(task);
        }
    }

    /**
     * Cross-verifies an already completed download against Lidarr's state to catch import rejections.
     * @param {DownloadTask} task - The completed task waiting to be imported.
     * @private
     */
    async _processCompletedTask(task) {
        try {
            const lStatus = await this.checkLidarrImport(task);
            if (lStatus.status === 'blocked') {
                console.warn(`[Lidarr] Downloaded file for ${task.query} rejected by Lidarr (mismatch). Retrying automatically.`);
                if (lStatus.queueId) {
                    await this._removeBlockedItemFromLidarr(lStatus.queueId);
                }
                this.recordFailureAndRetry(task, `Lidarr rejected imported files`);
            } else if (lStatus.status === 'imported') {
                console.log(`[Lidarr] Successfully imported "${task.query}"! Removing from queue.`);
                this.removeTasks([task.hash]);
            }
        } catch (e) {
            // Ignored transient error
        }
    }

    /**
     * Attempts to clear an item that has been blocked from Lidarr's queue.
     * @param {number|string} queueId - Lidarr's queue ID for the blocked item.
     * @private
     */
    async _removeBlockedItemFromLidarr(queueId) {
        try {
            await lidarrBridge.deleteQueueItem(queueId);
            console.log(`[Lidarr] Removed rejected item (ID: ${queueId}) from Lidarr queue.`);
        } catch (e) {
            console.error(`[Lidarr] Unable to remove item from queue: ${e.message}`);
        }
    }

    /**
     * Spawns a timer for a completed download that will penalize and retry
     * the task if Lidarr takes too long to import it.
     * @param {DownloadTask} task - The task mapped to the timeout.
     */
    startImportTimeout(task) {
        task.importTimer = setTimeout(async () => {
            const isImported = await this.checkLidarrImport(task);
            if (isImported.status !== 'imported' && isImported.status !== 'pending') {
                console.warn(`[Queue] Lidarr didn't import ${task.query} after timeout. Marking failure and restarting search.`);
                this.recordFailureAndRetry(task);
            } else if (isImported.status === 'pending') {
                console.log(`[Queue] Lidarr is still processing ${task.query}, giving it more time...`);
                this.startImportTimeout(task);
            }
        }, parseInt(dbManager.getSetting('import_timeout')) || 600000);
    }

    /**
     * Records a failure for a specific peer on a task, wipes the local failed payload, and retries.
     * @param {DownloadTask} task - The failing task.
     */
    recordFailureAndRetry(task, errorMessage = '') {
        if (!this.failedAttempts[task.query]) this.failedAttempts[task.query] = [];
        if (task.downloadUser) {
            this.failedAttempts[task.query].push(task.downloadUser);
            // Non blocchiamo l'esecuzione per completare questo delete
            slskdApi.deleteDownloadFolder(task.downloadDir, task.downloadUser).catch(e => console.error(e));
        }
        
        if (task.importTimer) {
            clearTimeout(task.importTimer);
            task.importTimer = null;
        }

        task.progress = 0;
        task.status = 'pending';
        task.downloadUser = null;
        task.downloadDir = null;
        if (errorMessage) task.errorMessage = errorMessage;
        this.enqueueSearch(task);
    }    /**
     * Queries Lidarr APIs directly to determine the import state of the downloaded file.
     * @param {DownloadTask} task - The downloaded task in question.
     * @returns {Promise<Object>} An object determining whether the status is pending, blocked, imported, or unknown.
     */
    async checkLidarrImport(task) {
        try {
            const records = await lidarrBridge.getQueue();
            const qItem = records.find(r => r.downloadId === task.hash);
            
            if (qItem) {
                const isBlocked = qItem.trackedDownloadState === 'ImportBlocked' || qItem.status === 'Warning';
                if (isBlocked) {
                    const warnings = (qItem.statusMessages || []).map(m => m.messages.join(', ')).join(' | ');
                    // Logga solo saltuariamente l'errore per non intasare la console
                    if (!task.lastLidarrWarn || Date.now() - task.lastLidarrWarn > 30000) {
                        console.log(`[Lidarr-Check] Lidarr refuses to import ${task.query}: ${warnings}. Blacklisting user & retrying.`);
                        task.lastLidarrWarn = Date.now();
                    }
                    return { status: 'blocked', queueId: qItem.id };
                }
                return { status: 'pending' };
            }
            
            // If it's not in Lidarr's queue but was marked completed, it might have been successfully imported
            // and removed from the queue. Let's check the history.
            // Lidarr può usare nomi come albumFolderImported, trackImported o downloadFolderImported
            const histRecords = await lidarrBridge.getHistory();
            const imported = histRecords.some(r => {
                const matchHash = r.downloadId && r.downloadId.toLowerCase() === task.hash.toLowerCase();
                const isSuccessEvent = r.eventType && r.eventType.toLowerCase().includes('import');
                return matchHash && isSuccessEvent;
            });
            
            if (imported) {
                 return { status: 'imported' };
            }
            
            // Se non c'è in locale, né in cronologia come importato, assumiamo che Lidarr lo abbia abbandonato
            if (!task.lastUnknownLog || Date.now() - task.lastUnknownLog > 60000) {
                console.log(`[Lidarr-Check] Item non trovato né in coda né in history come import. DownloadId: ${task.hash}. In attesa che Lidarr lo processi...`);
                task.lastUnknownLog = Date.now();
            }
            return { status: 'unknown' };

        } catch (error) {
            console.error(`[Lidarr-Check] API Error: ${error.message}`);
            return { status: 'error' };
        }
    }

    async removeLidarrQueueItem(hash, queueId) {
        try {
            await lidarrBridge.deleteQueueItem(queueId);
            console.log(`[Queue] Removed task ${this.tasks.get(hash)?.query} from Lidarr queue.`);
        } catch (err) {
            console.error(`[Queue] Failed to remove task ${this.tasks.get(hash)?.query} from Lidarr queue:`, err.message);
        }
    }

    async enforceQueueConsistency() {
        try {
            const lidarrQueue = await lidarrBridge.getQueue();
            const lidarrHistory = await lidarrBridge.getHistory();

            for (const [hash, task] of this.tasks.entries()) {
                const queueItem = lidarrQueue.find(q => q.downloadId === hash);
                if (!queueItem) {
                    // Non c'è più in coda, verifichiamo la cronologia
                    const histItem = lidarrHistory.find(h => h.downloadId === hash);
                    if (histItem) {
                        // Trovato in cronologia, presumibilmente importato
                        console.log(`[Queue] Task ${task.query} appears to be imported already. Removing from active queue.`);
                        this.removeTasks([hash]);
                    }
                }
            }
        } catch (err) {
            console.error(`[Queue] Consistency check failed:`, err.message);
        }
    }
}

const queueManager = new QueueManager();
module.exports = queueManager;
