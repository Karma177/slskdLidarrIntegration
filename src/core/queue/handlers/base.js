/**
 * Interface/Base class for a Queue Handler.
 */
class BaseQueueHandler {
    constructor(name) {
        this.name = name;
        this.activeSearches = 0;
        this.maxConcurrent = 1;
        this.queue = [];
    }

    /**
     * Checks if this handler accepts the task for search/download.
     * @param {DownloadTask} task 
     * @returns {boolean}
     */
    canHandle(task) {
        return true; 
    }

    /**
     * Adds task to its local queue.
     * @param {DownloadTask} task 
     */
    enqueue(task) {
        if (!this.queue.find(t => t.hash === task.hash)) {
            this.queue.push(task);
            this.pump();
        }
    }

    /**
     * Pumps the internal queue. Must be overridden ideally by subclasses
     * to manage specific concurrency or flow logic.
     */
    async pump() {
        while (this.activeSearches < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            this.activeSearches++;
            
            this.execute(task)
                .catch(e => console.error(`[${this.name} Queue] Error:`, e))
                .finally(() => {
                    this.activeSearches--;
                    this.pump();
                });
        }
    }

    /**
     * Abstract logic to execute a search and start download.
     * Should resolve with { success: boolean, retryAllowed: boolean, error: string }
     * @param {DownloadTask} task 
     */
    async execute(task) {
        throw new Error('Not implemented');
    }
}

module.exports = BaseQueueHandler;