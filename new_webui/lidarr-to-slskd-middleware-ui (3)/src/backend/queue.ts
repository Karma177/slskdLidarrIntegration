import { requestDownload, checkDownloadStatus, deleteDownloadFolder, retryDownloadFiles } from './slskdClient.js';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { getSettings, addToHistory } from './db.js';

class Mutex {
    locked = false;
    waiters: any[] = [];
    async acquire() {
        if (this.locked) {
            await new Promise(resolve => this.waiters.push(resolve));
        }
        this.locked = true;
    }
    release() {
        if (this.waiters.length > 0) {
            const resolve = this.waiters.shift();
            resolve();
        } else {
            this.locked = false;
        }
    }
}

class DownloadTask {
    hash: string;
    nameObj: any;
    query: string;
    progress: number = 0;
    status: string = 'pending';
    errorMessage: string = '';
    downloadUser: string | null = null;
    downloadDir: string | null = null;
    downloadStartTime: number | null = null;
    attempts: number = 0;
    maxAttempts: number = 3;
    importTimer: any = null;
    totalSize: number = 0;
    downloadedSize: number = 0;
    retriedFiles: Set<string> = new Set();
    lastLidarrWarn?: number;
    lastUnknownLog?: number;

    constructor(hash: string, nameObj: any) {
        this.hash = hash;
        this.nameObj = nameObj;
        this.query = typeof nameObj === 'string' ? nameObj : nameObj.filterQuery;
    }

    canRetry() { return this.attempts < this.maxAttempts; }
    markAsSearching() { this.status = 'searching'; this.attempts++; }
    markAsDownloading(user: string, dir: string) {
        this.status = 'downloading';
        this.downloadUser = user;
        this.downloadDir = dir;
        this.downloadStartTime = Date.now();
    }
    markAsCompleted() { this.status = 'completed'; this.progress = 1; }
    markAsError(message = '') { this.status = 'error'; this.errorMessage = message; }
    markAsFailed(message = '') { this.status = 'failed'; this.errorMessage = message; }
}

class QueueManager {
    tasks = new Map<string, DownloadTask>();
    failedAttempts: Record<string, string[]> = {};
    activeSearches = 0;
    searchQueue: DownloadTask[] = [];
    pumpMutex = new Mutex();

    enqueueSearch(task: DownloadTask) {
        if (!this.searchQueue.find(t => t.hash === task.hash)) {
            this.searchQueue.push(task);
            this.pumpQueue();
        }
    }

    async pumpQueue() {
        await this.pumpMutex.acquire();
        try {
            while (this.activeSearches < 3 && this.searchQueue.length > 0) {
                const task = this.searchQueue.shift()!;
                this.activeSearches++;
                this.executeSlskdSearch(task)
                    .catch(e => console.error(e))
                    .finally(() => {
                        this.activeSearches--;
                        this.pumpQueue(); 
                    });
            }
        } finally {
            this.pumpMutex.release();
        }
    }

    getQueueAsQbitArray() {
        return Array.from(this.tasks.values()).map(task => this._mapTaskToQbit(task));
    }

    getQueueAsUIArray() {
        return Array.from(this.tasks.values()).map(task => ({
            hash: task.hash,
            query: task.query,
            status: task.status,
            progress: task.progress,
            totalSize: task.totalSize,
            downloadedSize: task.downloadedSize,
            errorMessage: task.errorMessage
        }));
    }

    _mapTaskToQbit(task: DownloadTask) {
        const settings = getSettings();
        let qbitState = 'downloading';
        let leafDir = '';
        const dirParts = task.downloadDir ? task.downloadDir.split(/[\\/]/).filter(p => p.trim() !== '') : [];
        leafDir = dirParts.length > 0 ? dirParts[dirParts.length - 1] : typeof task.nameObj === 'string' ? task.nameObj : task.nameObj.filterQuery;

        if (task.status === 'completed' && task.progress === 1) {
            qbitState = 'pausedUP';
        } else if (task.status === 'failed' || task.status === 'error') {
            qbitState = 'pausedDL';
            leafDir = `[SLSKD ERROR: ${task.errorMessage || 'Failed'}] ${leafDir}`;
        }

        const remainingBytes = (task.totalSize || 0) - (task.downloadedSize || 0);
        let eta = 8640000;
        let dlspeed = 0;
        if (task.status === 'downloading' && task.totalSize > 0 && task.downloadStartTime) {
            dlspeed = task.downloadedSize > 0 ? (task.downloadedSize / ((Date.now() - task.downloadStartTime) / 1000)) : 1024 * 1024;
            eta = dlspeed > 0 ? remainingBytes / dlspeed : 8640000;
        }

        let basePath = settings.downloadPath || '/app/data/downloads';
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

    async addDownloadTask(hash: string, nameObj: any) {
        if (this.tasks.has(hash)) return;
        const task = new DownloadTask(hash, nameObj);
        this.tasks.set(hash, task);
        this.enqueueSearch(task);
    }

    async executeSlskdSearch(task: DownloadTask) {
        if (!this.tasks.has(task.hash)) return;

        if (!task.canRetry()) {
            task.markAsFailed('Exceeded max attempts. No usable results found.');
            addToHistory(task.hash, task.query, 'failed', task.errorMessage);
            return;
        }

        task.markAsSearching();
        const failedUsers = this.failedAttempts[task.query] || [];
        const result = await requestDownload(task.nameObj, failedUsers);
        
        if (result.success) {
            task.markAsDownloading(result.user, result.directory);
        } else {
            task.markAsError(result.error || 'No valid results found');
        }
    }

    removeTasks(hashes: string[]) {
        hashes.forEach(hash => {
            const task = this.tasks.get(hash);
            if (task) {
                if (task.downloadUser && task.downloadDir) {
                    deleteDownloadFolder(task.downloadDir, task.downloadUser).catch(e => console.error(e));
                }
                if (task.importTimer) clearTimeout(task.importTimer);
                if (task.query && this.failedAttempts[task.query]) delete this.failedAttempts[task.query];
                this.tasks.delete(hash);
            }
        });
    }

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

    async _processDownloadingTask(task: DownloadTask) {
        if ((task as any).isMock) {
            if (task.progress < 1) {
                task.progress += Math.random() * 0.05 + 0.01;
                if (task.progress >= 1) {
                    task.progress = 1;
                    task.status = 'completed';
                    addToHistory(task.hash, task.query, 'success');
                }
                task.downloadedSize = Math.floor(task.totalSize * Math.min(1, task.progress));
            }
            return;
        }

        const status = await checkDownloadStatus(task);
        task.progress = status.progress;
        task.totalSize = status.totalBytes;
        task.downloadedSize = status.downloadedBytes;
        
        if (status.failed) {
            const filesToRetry = (status.failedFiles || []).filter((f: any) => !task.retriedFiles.has(f.filename));
            if (filesToRetry.length > 0 && task.downloadUser) {
                filesToRetry.forEach((f: any) => task.retriedFiles.add(f.filename));
                const retrySuccess = await retryDownloadFiles(task.downloadUser, filesToRetry);
                if (retrySuccess) return; 
            }
            this.recordFailureAndRetry(task, `User ${task.downloadUser} rejected or timed out`);
        } else if (status.completed && !task.importTimer) {
            task.markAsCompleted();
            this.startImportTimeout(task);
        }
    }

    async _processCompletedTask(task: DownloadTask) {
        if ((task as any).isMock) return;
        try {
            const lStatus = await this.checkLidarrImport(task);
            if (lStatus.status === 'blocked') {
                if (lStatus.queueId) await this._removeBlockedItemFromLidarr(lStatus.queueId);
                this.recordFailureAndRetry(task, `Lidarr rejected imported files`);
            } else if (lStatus.status === 'imported') {
                addToHistory(task.hash, task.query, 'success');
                this.removeTasks([task.hash]);
            }
        } catch (e) {}
    }

    async _removeBlockedItemFromLidarr(queueId: string) {
        const settings = getSettings();
        const client = axios.create({ baseURL: settings.lidarrApiUrl, headers: { 'X-Api-Key': settings.lidarrApiKey }});
        try {
            await client.delete(`/api/v1/queue/${queueId}?removeFromClient=false&blocklist=false`);
        } catch (e) {}
    }

    startImportTimeout(task: DownloadTask) {
        const settings = getSettings();
        task.importTimer = setTimeout(async () => {
            const isImported = await this.checkLidarrImport(task);
            if (isImported.status !== 'imported' && isImported.status !== 'pending') {
                this.recordFailureAndRetry(task, "Lidarr import timeout");
            } else if (isImported.status === 'pending') {
                this.startImportTimeout(task);
            }
        }, parseInt(settings.importTimeout || '600000'));
    }

    recordFailureAndRetry(task: DownloadTask, errorMessage = '') {
        if (!this.failedAttempts[task.query]) this.failedAttempts[task.query] = [];
        if (task.downloadUser) {
            this.failedAttempts[task.query].push(task.downloadUser);
            deleteDownloadFolder(task.downloadDir!, task.downloadUser).catch(e => console.error(e));
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
    }

    async checkLidarrImport(task: DownloadTask) {
        const settings = getSettings();
        const client = axios.create({ baseURL: settings.lidarrApiUrl, headers: { 'X-Api-Key': settings.lidarrApiKey }});
        try {
            const res = await client.get(`/api/v1/queue`);
            const records = res.data.records || [];
            const qItem = records.find((r: any) => r.downloadId === task.hash);
            
            if (qItem) {
                const isBlocked = qItem.trackedDownloadState === 'ImportBlocked' || qItem.status === 'Warning';
                if (isBlocked) {
                    task.lastLidarrWarn = Date.now();
                    return { status: 'blocked', queueId: qItem.id };
                }
                return { status: 'pending' };
            }
            
            const histRes = await client.get(`/api/v1/history?page=1&pageSize=100&sortDirection=descending&sortKey=date`);
            const imported = histRes.data.records.some((r: any) => {
                const matchHash = r.downloadId && r.downloadId.toLowerCase() === task.hash.toLowerCase();
                const isSuccessEvent = r.eventType && r.eventType.toLowerCase().includes('import');
                return matchHash && isSuccessEvent;
            });
            if (imported) return { status: 'imported' };
            
            task.lastUnknownLog = Date.now();
            return { status: 'unknown' };

        } catch (error) {
            return { status: 'error' };
        }
    }
}

const queueManager = new QueueManager();
export default queueManager;
