const axios = require('axios');
const http = require('http');
const https = require('https');
const dbManager = require('../../db/db-access');

const formatError = (err) => {
    if (err.response) return `HTTP ${err.response.status} - ${err.response.statusText}`;
    let msg = err.message || err.toString();
    const errors = err.errors || (err.cause && err.cause.errors) || [];
    if (Array.isArray(errors) && errors.length > 0) {
        return `${msg} - Details: ${errors.map(e => e.message || e).join(', ')}`;
    }
    if (err.cause) return `${msg} (Cause: ${err.cause.message || err.cause})`;
    return msg;
};

class LidarrBridge {
    constructor() {
        this.httpAgent = new http.Agent({ keepAlive: true });
        this.httpsAgent = new https.Agent({ keepAlive: true });
    }

    getClient() {
        const lidarrApi = dbManager.getApi('lidarr');
        if (!lidarrApi || !lidarrApi.api_url) {
            throw new Error('Lidarr API non configurata nel database.');
        }
        
        return axios.create({
            baseURL: lidarrApi.api_url,
            headers: { 'X-Api-Key': lidarrApi.api_key || '' },
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent,
            timeout: 10000
        });
    }

    async getSystemStatus() {
        try {
            const res = await this.getClient().get('/system/status');
            return res.data;
        } catch (err) {
            console.error(`[Lidarr Bridge] Errore connessione a Lidarr:`, formatError(err));
            throw err;
        }
    }

    async getQueue() {
        try {
            const res = await this.getClient().get('/queue');
            return res.data.records || [];
        } catch (err) {
            console.error(`[Lidarr Bridge] Fallito caricamento coda da Lidarr:`, formatError(err));
            return [];
        }
    }

    async getHistory() {
        try {
            const res = await this.getClient().get('/history?page=1&pageSize=100&sortDirection=descending&sortKey=date');
            return res.data.records || [];
        } catch (err) {
            console.error(`[Lidarr Bridge] Fallito caricamento history Lidarr:`, formatError(err));
            return [];
        }
    }

    async deleteQueueItem(queueId, removeFromClient = false, blocklist = false) {
        try {
            await this.getClient().delete(`/queue/${queueId}?removeFromClient=${removeFromClient}&blocklist=${blocklist}`);
            return true;
        } catch (err) {
            console.error(`[Lidarr Bridge] Impossibile rimuovere queue item ${queueId}:`, formatError(err));
            return false;
        }
    }

    async triggerImport(path) {
        try {
            await this.getClient().post('/command', {
                name: 'DownloadedAlbumsScan',
                path: path
            });
            console.log(`[Lidarr Bridge] Triggerato import manuale per path: ${path}`);
            return true;
        } catch (err) {
            console.error(`[Lidarr Bridge] Errore avvio import manuale su Lidarr:`, formatError(err));
            return false;
        }
    }
}

module.exports = new LidarrBridge();
