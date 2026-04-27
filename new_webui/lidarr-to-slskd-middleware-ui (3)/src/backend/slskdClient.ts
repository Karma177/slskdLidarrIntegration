import axios from 'axios';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { getSettings } from './db.js';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const getClient = () => {
  const settings = getSettings();
  return axios.create({
    baseURL: settings.slskdApiUrl || 'http://localhost:5030',
    headers: { 'X-API-KEY': settings.slskdApiKey },
    httpAgent,
    httpsAgent
  });
};

const generateSearchId = () => crypto.randomUUID();

const normalizeStr = (str: string) => {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ") : "";
};

const calculateLCSLength = (arr1: string[], arr2: string[]) => {
    const matrix = Array(arr1.length + 1).fill(0).map(() => Array(arr2.length + 1).fill(0));
    for (let i = 1; i <= arr1.length; i++) {
        for (let j = 1; j <= arr2.length; j++) {
            if (arr1[i - 1] === arr2[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
            }
        }
    }
    return matrix[arr1.length][arr2.length];
};

const findBestCandidate = (responses: any[], queryWords: string[], blacklist: string[]) => {
    const settings = getSettings();
    let highestScore = -2;
    let bestCandidate: any = null;

    for (const response of responses) {
        const username = response.username;
        if (blacklist && blacklist.includes(username)) continue;
        
        if (!response.files || response.files.length === 0) continue;
        
        const validFiles = response.files.filter((f: any) => !f.isLocked);
        for (const file of validFiles) {
            const filePath = file.filename;
            const dirPath = filePath.substring(0, Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')));
            
            const normPath = normalizeStr(filePath);
            const normDir = normalizeStr(dirPath);
            const dirWords = normDir.split(' ').filter(w => w.trim().length > 0);
            
            const lcsScoreDir = queryWords.length > 0 ? (calculateLCSLength(queryWords, dirWords) / queryWords.length) : 0;
            
            let matchedWords = 0;
            for (const word of queryWords) {
                if (normPath.includes(word)) matchedWords++;
            }
            const jumbledScorePath = queryWords.length > 0 ? (matchedWords / queryWords.length) : 0;

            let score = (lcsScoreDir * 0.7) + (jumbledScorePath * 0.3);

            const preferences = (settings.qualityPreferences || '').split(',').map((p: string) => p.trim());
            for (let i = 0; i < preferences.length; i++) {
                const prefWord = normalizeStr(preferences[i]);
                if (prefWord && normPath.includes(prefWord)) {
                    score += Math.max(0.1, 0.5 - (i * 0.05));
                    break;
                }
            }
            
            score -= (dirPath.length * 0.0001);

            if (score > highestScore) {
                highestScore = score;
                bestCandidate = { username, dirPath, score, filename: filePath };
            }
        }
    }
    
    return highestScore > -1 ? bestCandidate : null;
};

export const requestDownload = async (queryObj: any, blacklist: string[]) => {
    const client = getClient();
    try {
        const searchId = generateSearchId();
        const networkQuery = typeof queryObj === 'string' ? queryObj : queryObj.networkQuery;
        const filterQuery = typeof queryObj === 'string' ? queryObj : queryObj.filterQuery;
        console.log(`[SLSKD] Starting search for: ${networkQuery} (Filter: ${filterQuery})`);
        
        await client.post('/api/v0/searches', { id: searchId, searchText: networkQuery });
        
        let waited = 0;
        const maxWait = 15000;
        const pollInterval = 2000;
        
        while (waited < maxWait) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            waited += pollInterval;
            try {
                const statusRes = await client.get(`/api/v0/searches/${searchId}`);
                if (statusRes.data && (statusRes.data.isComplete || statusRes.data.state === 'Completed' || statusRes.data.state === 'Faulted' || statusRes.data.state === 'Cancelled')) {
                    console.log(`[SLSKD] Soulseek network finished search in ${waited / 1000}s`);
                    break;
                }
            } catch (err) {}
        }
        
        const resultsRes = await client.get(`/api/v0/searches/${searchId}/responses`);
        const responses = resultsRes.data || [];
        
        const queryWords = normalizeStr(filterQuery).split(' ').filter(w => w.trim().length > 2);
        const bestCandidate = findBestCandidate(responses, queryWords, blacklist);
        
        await client.delete(`/api/v0/searches/${searchId}`).catch(() => {});
        
        if (bestCandidate) {
            console.log(`[SLSKD] Best match: ${bestCandidate.username} with score ${bestCandidate.score.toFixed(2)}`);
            
            const userResponse = responses.find((r: any) => r.username === bestCandidate.username);
            let filesToDownload = [];
            if (userResponse && userResponse.files) {
                filesToDownload = userResponse.files
                    .filter((f: any) => f.filename.startsWith(bestCandidate.dirPath))
                    .map((f: any) => ({ filename: f.filename, size: f.size }));
            }
            
            if (filesToDownload.length === 0) {
                const fallbackFile = userResponse && userResponse.files ? userResponse.files.find((f: any) => f.filename === bestCandidate.filename) : null;
                filesToDownload = [{ filename: bestCandidate.filename, size: fallbackFile ? fallbackFile.size : 0 }];
            }

            await client.post(`/api/v0/transfers/downloads/${bestCandidate.username}`, filesToDownload);
            return { success: true, user: bestCandidate.username, directory: bestCandidate.dirPath };
        }

        return { success: false, error: 'No results found' };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const checkDownloadStatus = async (task: any) => {
    const client = getClient();
    try {
        if (!task.downloadUser) {
            return { progress: 0, completed: false };
        }
        
        const res = await client.get(`/api/v0/transfers/downloads/${task.downloadUser}`);
        const directories = res.data.directories || [];
        
        let downloads: any[] = [];
        for (const dir of directories) downloads = downloads.concat(dir.files || []);
        
        let totalBytes = 0;
        let downloadedBytes = 0;
        let allComplete = true;
        let foundMatch = false;
        let hasFailed = false;
        let failedFiles: any[] = [];

        for (const dl of downloads) {
            if (dl.filename === task.downloadDir || dl.filename.startsWith(task.downloadDir + '\\') || dl.filename.startsWith(task.downloadDir + '/')) {
                foundMatch = true;
                totalBytes += dl.size;
                downloadedBytes += dl.bytesTransferred;
                
                if (dl.state.includes('Rejected') || dl.state.includes('Error') || dl.state.includes('Cancelled') || dl.state.includes('Aborted') || dl.state.includes('TimedOut') || dl.state.includes('Timed Out')) {
                    hasFailed = true;
                    failedFiles.push(dl);
                }
                
                if (!dl.state.includes('Completed') || dl.state.includes('TimedOut') || dl.state.includes('Error')) {
                    allComplete = false;
                }
            }
        }

        if (!foundMatch) return { progress: 0, completed: false, failed: false, failedFiles: [] };

        const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) : 0;
        return {
            progress: progress,
            completed: (allComplete && totalBytes > 0) && !hasFailed,
            failed: hasFailed,
            failedFiles: failedFiles,
            totalBytes: totalBytes,
            downloadedBytes: downloadedBytes
        };
    } catch (error: any) {
        return { progress: 0, completed: false, error: error.message };
    }
};

export const deleteDownloadFolder = async (directory: string, username: string) => {
    const client = getClient();
    try {
        if (!username || !directory || directory.trim() === '') return false;
        const res = await client.get(`/api/v0/transfers/downloads/${username}`);
        const directories = res.data.directories || [];
        let filesToDelete: string[] = [];
        
        for (const dir of directories) {
            for (const file of (dir.files || [])) {
                if (file.filename === directory || file.filename.startsWith(directory + '\\') || file.filename.startsWith(directory + '/')) {
                    filesToDelete.push(file.id);
                }
            }
        }
        
        for (const id of filesToDelete) {
            try {
                await client.delete(`/api/v0/transfers/downloads/${username}/${id}`);
            } catch (err) {}
        }
        return true;
    } catch (error) {
        return false;
    }
};

export const retryDownloadFiles = async (username: string, files: any[]) => {
    const client = getClient();
    try {
        if (!username || !files || files.length === 0) return false;
        const filesToDownload = files.map(f => ({ filename: f.filename, size: f.size }));
        await client.post(`/api/v0/transfers/downloads/${username}`, filesToDownload);
        return true;
    } catch (error) {
        return false;
    }
};
