/**
 * A simple asynchronous Mutex for preventing race conditions.
 */
class Mutex {
    constructor() {
        this.locked = false;
        this.waiters = [];
    }

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

module.exports = Mutex;
