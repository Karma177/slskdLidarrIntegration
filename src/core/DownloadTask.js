const dbManager = require('./db/db-access');

/**
 * Represents a single background download task mapped from Lidarr to Slskd/Lucida.
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
        this.errorMessage = '';
        this.downloadUser = null;
        this.downloadDir = null;
        this.downloadStartTime = null;
        this.attempts = 0;
        this.maxAttempts = parseInt(dbManager.getSetting('max_retries'), 10) || 3;
        this.importTimer = null;
        this.totalSize = 0;
        this.downloadedSize = 0;
        this.retriedFiles = new Set();
        this.currentQueueHandlerIndex = 0; // Traccia in quale fallback ci troviamo
        this.fallbackOrder = (dbManager.getSetting('fallback_order') || 'slskd,tidal,qobuz,spotify').split(',').map(s => s.trim());
    }

    /**
     * Checks if the task is allowed to retry searches.
     * @returns {boolean} True if attempts are less than max attempts.
     */
    canRetry() {
        return this.attempts < this.maxAttempts;
    }

    /**
     * Marks the task as actively searching.
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
    markAsError(message = '') {
        this.status = 'error';
        this.errorMessage = message;
    }

    /**
     * Marks the task as completely failed (hard failure, out of retries).
     */
    markAsFailed(message = '') {
        this.status = 'failed';
        this.errorMessage = message;
    }
}

module.exports = DownloadTask;