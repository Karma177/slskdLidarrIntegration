const slskdApi = require('../slskd/api');
const config = require('../../config');
const axios = require('axios');

/**
 * Represents a single background download task mapped from Lidarr to Slskd.
 */
class DownloadTask {
    /**
     * Initializes a new Download Task.
     * @param {string} hash - The unique hash identifying the task.
     * @param {string|Object} nameObj - The parsed name or query object from Lidarr.
     */
    constructor(hash, nameObj) {
        this.hash = hash;
        this.name = nameObj;
        this.query = typeof nameObj === 'string' ? nameObj : nameObj.filterQuery;
        this.progress = 0;
        this.status = 'pending'; // pending, searching, downloading, completed, error, failed
        this.downloadUser = null;
        this.downloadDir = null;
        this.downloadStartTime = null;
        this.attempts = 0;
        this.maxAttempts = config.slskd.maxRetries || 3;
        this.importTimer = null;
        this.totalSize = 0;
        this.downloadedSize = 0;
    }

    /**
     * Checks if the task is allowed to retry searches.
     * @returns {boolean} True if attempts are less than max attempts.
     */
    canRetry() {
        return this.attempts < this.maxAttempts;
    }

    /**
     * Marks the task as actively searching on Slskd and increments the attempt counter.
     */
    markAsSearching() {
        this.status = 'searching';
        this.attempts++;
    }

    /**
     * Marks the task as actively downloading files from a specific user.
     * @param {string} user - The Slskd username being downloaded from.
     * @param {string} dir - The remote directory path being downloaded.
     */
    markAsDownloading(user, dir) {
        this.status = 'downloading';
        this.downloadUser = user;
        this.downloadDir = dir;
        this.downloadStartTime = Date.now();
    }

    /**
     * Marks the task as fully downloaded and ready for Lidarr import.
     */
    markAsCompleted() {
        this.status = 'completed';
        this.progress = 1;
    }

    /**
     * Marks the task as having encountered an error (soft failure).
     */
    markAsError() {
        this.status = 'error';
    }

    /**
     * Marks the task as completely failed (hard failure, out of retries).
     */
    markAsFailed() {
        this.status = 'failed';
    }
}

/**
 * Manages the entire lifecycle of download tasks, including queuing, polling states,
 * interacting with the Slskd API, and updating Lidarr's state.
 */
class QueueManager {
    /**
     * Initializes the QueueManager.
     */
    constructor() {
        this.tasks = new Map(); // hash -> DownloadTask
        this.failedAttempts = {}; // query -> array of users that failed
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
        if (task.status === 'completed' && task.progress === 1) {
            qbitState = 'pausedUP';
        } else if (task.status === 'failed' || task.status === 'error') {
            qbitState = 'error';
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

        const dirParts = task.downloadDir ? task.downloadDir.split(/[\\/]/).filter(p => p.trim() !== '') : [];
        const leafDir = dirParts.length > 0 ? dirParts[dirParts.length - 1] : typeof task.name === 'string' ? task.name : task.name.filterQuery;
        let basePath = config.slskd.downloadDir || '/app/data/downloads';
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
            tags: 'slskd'
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
        await this.executeSlskdSearch(task);
    }

    /**
     * Commands the Slskd API to initiate a search and attempt downloading the task.
     * @param {DownloadTask} task - The task object initiating the search.
     */
    async executeSlskdSearch(task) {
        if (!this.tasks.has(task.hash)) {
            console.log(`[Queue] Task ${task.query} was removed manually, cancelling Slskd search.`);
            return;
        }

        if (!task.canRetry()) {
            console.error(`[Queue] Task ${task.query} exceeded max attempts (${task.maxAttempts}). Marked as failed.`);
            task.markAsFailed();
            return;
        }

        task.markAsSearching();
        const failedUsers = this.failedAttempts[task.query] || [];
        const result = await slskdApi.requestDownload(task.name, failedUsers);
        
        if (result.success) {
            task.markAsDownloading(result.user, result.directory);
        } else {
            console.warn(`[Queue] No results found for ${task.query}, will retry in future or eventually flag as error.`);
            task.markAsError();
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
            console.warn(`[Queue] Task for ${task.query} reported an error or user ${task.downloadUser} rejected the queue. Flagging as error and retrying search.`);
            this.recordFailureAndRetry(task);
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
                this.recordFailureAndRetry(task);
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
            await axios.delete(`${config.lidarr.apiUrl}/queue/${queueId}?removeFromClient=false&blocklist=false`, {
                headers: { 'X-Api-Key': config.lidarr.apiKey }
            });
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
        }, config.importTimeout || 600000);
    }

    /**
     * Records a failure for a specific peer on a task, wipes the local failed payload, and retries.
     * @param {DownloadTask} task - The failing task.
     */
    recordFailureAndRetry(task) {
        if (!this.failedAttempts[task.query]) this.failedAttempts[task.query] = [];
        if (task.downloadUser) {
            this.failedAttempts[task.query].push(task.downloadUser);
            slskdApi.deleteDownloadFolder(task.downloadDir, task.downloadUser).catch(e => console.error(e));
        }
        
        if (task.importTimer) {
            clearTimeout(task.importTimer);
            task.importTimer = null;
        }
        
        task.progress = 0;
        this.executeSlskdSearch(task);
    }

    /**
     * Queries Lidarr APIs directly to determine the import state of the downloaded file.
     * @param {DownloadTask} task - The downloaded task in question.
     * @returns {Promise<Object>} An object determining whether the status is pending, blocked, imported, or unknown.
     */
    async checkLidarrImport(task) {
        try {
            const res = await axios.get(`${config.lidarr.apiUrl}/queue`, {
                headers: { 'X-Api-Key': config.lidarr.apiKey }
            });
            
            const records = res.data.records || [];
            const qItem = records.find(r => r.downloadId === task.hash);
            
            if (qItem) {
                const isBlocked = qItem.trackedDownloadState === 'ImportBlocked' || qItem.status === 'Warning';
                if (isBlocked) {
                    const warnings = (qItem.statusMessages || []).map(m => m.messages.join(', ')).join(' | ');
                    console.log(`[Lidarr-Check] Lidarr refuses to import ${task.query}: ${warnings}. Blacklisting user & retrying.`);
                    return { status: 'blocked', queueId: qItem.id };
                }
                return { status: 'pending' };
            }
            
            // If it's not in Lidarr's queue but was marked completed, it might have been successfully imported
            // and removed from the queue. Let's check the history.
            const histRes = await axios.get(`${config.lidarr.apiUrl}/history?page=1&pageSize=30&sortDirection=descending&sortKey=date`, {
                headers: { 'X-Api-Key': config.lidarr.apiKey }
            });
            const imported = histRes.data.records.some(r => r.eventType === 'downloadFolderImported' && r.downloadId === task.hash);
            
            if (imported) {
                 return { status: 'imported' };
            }
            return { status: 'unknown' };

        } catch (error) {
            console.error(`[Lidarr-Check] API Error: ${error.message}`);
            return { status: 'error' };
        }
    }
}

const queueManager = new QueueManager();
module.exports = queueManager;
