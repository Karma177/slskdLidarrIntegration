require('events').EventEmitter.defaultMaxListeners = 50;

const axios = require('axios');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const config = require('../../config');

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

// Usa Axios base con rimozione del Warning Max Listeners
const slskdClient = axios.create({
    baseURL: config.slskd.apiUrl,
    headers: { 'X-API-KEY': config.slskd.apiKey },
    httpAgent,
    httpsAgent
});

/**
 * Generates a random GUID/UUID string for search IDs.
 * @returns {string} The formatted UUID
 */
const generateSearchId = () => crypto.randomUUID();

/**
 * Normalizes a string by removing accents, changing to lowercase, and keeping only alphanumerics.
 * @param {string} str - The string to normalize.
 * @returns {string} The normalized string.
 */
const normalizeStr = (str) => {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ") : "";
};

/**
 * Computes the Longest Common Subsequence length between two arrays of words.
 * @param {string[]} arr1 - Primary array of words.
 * @param {string[]} arr2 - Array of words to compare against.
 * @returns {number} The integer length of the LCS.
 */
const calculateLCSLength = (arr1, arr2) => {
    const matrix = Array(arr1.length + 1).fill().map(() => Array(arr2.length + 1).fill(0));
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

/**
 * Retrieves the best matching response file based on LCS of folder name and overall query word matches.
 * @param {Array} responses - The raw responses from Slskd API.
 * @param {string[]} queryWords - Normalized array of words from the search query.
 * @param {string[]} blacklist - Array of strings containing usernames to ignore.
 * @returns {Object|null} The best candidate containing username, directory path, score and filepath.
 */
const findBestCandidate = (responses, queryWords, blacklist) => {
    let highestScore = -2;
    let bestCandidate = null;

    for (const response of responses) {
        const username = response.username;
        if (blacklist && blacklist.includes(username)) continue;
        
        if (!response.files || response.files.length === 0) continue;
        
        const validFiles = response.files.filter(f => !f.isLocked);
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

            const preferences = config.qualityPreferences || [];
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

/**
 * Initiates a search on the Slskd network, waits for results, evaluates candidate, and enqueues download.
 * @param {Object|string} queryObj - The search query object or string.
 * @param {string[]} blacklist - Array of blacklisted usernames to ignore.
 * @returns {Promise<Object>} An object containing the success status and details of the queued download.
 */
const requestDownload = async (queryObj, blacklist) => {
    try {
        const searchId = generateSearchId();
        const networkQuery = typeof queryObj === 'string' ? queryObj : queryObj.networkQuery;
        const filterQuery = typeof queryObj === 'string' ? queryObj : queryObj.filterQuery;
        console.log(`[SLSKD] Starting search for: ${networkQuery} (Filter: ${filterQuery})`);
        
        await slskdClient.post('/api/v0/searches', { id: searchId, searchText: networkQuery });
        
        let waited = 0;
        const maxWait = 60000;
        const pollInterval = 2000;
        
            while (waited < maxWait) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                waited += pollInterval;
                try {
                    const statusRes = await slskdClient.get(`/api/v0/searches/${searchId}`);
                    if (statusRes.data && (statusRes.data.isComplete || statusRes.data.state === 'Completed' || statusRes.data.state === 'Faulted' || statusRes.data.state === 'Cancelled')) {
                        console.log(`[SLSKD] Soulseek network finished search in ${waited / 1000}s`);
                        break;
                    }
                } catch (err) {}
            }        if (waited >= maxWait) console.log(`[SLSKD] Search ended due to Timeout of ${maxWait / 1000}s.`);
        
        const resultsRes = await slskdClient.get(`/api/v0/searches/${searchId}/responses`);
        const responses = resultsRes.data || [];
        console.log(`[SLSKD] Search gathered ${responses.length} user responses.`);
        
        const queryWords = normalizeStr(filterQuery).split(' ').filter(w => w.trim().length > 2);
        const bestCandidate = findBestCandidate(responses, queryWords, blacklist);
        
        await slskdClient.delete(`/api/v0/searches/${searchId}`);
        
        if (bestCandidate) {
            console.log(`[SLSKD] Best match: ${bestCandidate.username} with score ${bestCandidate.score.toFixed(2)}`);
            console.log(`[SLSKD] Enqueuing download from ${bestCandidate.username} for folder: ${bestCandidate.dirPath}`);
            
            const userResponse = responses.find(r => r.username === bestCandidate.username);
            let filesToDownload = [];
            if (userResponse && userResponse.files) {
                filesToDownload = userResponse.files
                    .filter(f => f.filename.startsWith(bestCandidate.dirPath))
                    .map(f => ({ filename: f.filename, size: f.size }));
            }
            
            if (filesToDownload.length === 0) {
                const fallbackFile = userResponse && userResponse.files ? userResponse.files.find(f => f.filename === bestCandidate.filename) : null;
                filesToDownload = [{ filename: bestCandidate.filename, size: fallbackFile ? fallbackFile.size : 0 }];
            }

            await slskdClient.post(`/api/v0/transfers/downloads/${bestCandidate.username}`, filesToDownload);
            return { success: true, user: bestCandidate.username, directory: bestCandidate.dirPath };
        }

        console.warn(`[SLSKD] No suitable non-blacklisted results found for: ${filterQuery}`);
        return { success: false, error: 'No results found' };
    } catch (error) {
        console.error('[SLSKD] Error requesting download:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Checks the status of an ongoing download for a specific task.
 * @param {Object} task - The download task object containing 'downloadUser' and 'downloadDir' properties.
 * @returns {Promise<Object>} Status object indicating download progress and failure states.
 */
const checkDownloadStatus = async (task) => {
    try {
        if (!task.downloadUser) {
            console.log(`[SLSKD] No download user associated with task ${task.name}, cannot check status.`);
            return { progress: 0, completed: false };
        }
        
        const res = await slskdClient.get(`/api/v0/transfers/downloads/${task.downloadUser}`);
        const directories = res.data.directories || [];
        
        let downloads = [];
        for (const dir of directories) downloads = downloads.concat(dir.files || []);
        
        let totalBytes = 0;
        let downloadedBytes = 0;
        let allComplete = true;
        let foundMatch = false;
        let hasFailed = false;
        let failedFiles = [];

        for (const dl of downloads) {
            if (dl.filename === task.downloadDir || dl.filename.startsWith(task.downloadDir + '\\') || dl.filename.startsWith(task.downloadDir + '/')) {
                foundMatch = true;
                totalBytes += dl.size;
                downloadedBytes += dl.bytesTransferred;
                
                if (dl.state.includes('Rejected') || dl.state.includes('Error') || dl.state.includes('Cancelled') || dl.state.includes('Aborted') || dl.state.includes('TimedOut') || dl.state.includes('Timed Out')) {
                    hasFailed = true;
                    failedFiles.push(dl);
                }
                
                // Un file non è veramente completato se è andato in errore o in timeout, anche se slskd lo indica come "Completed, TimedOut"
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
    } catch (error) {
        console.error('[SLSKD] API status check failed:', error.message);
        return { progress: 0, completed: false, error: error.message };
    }
};

/**
 * Deletes a download folder from the user's transfer queue by resolving file IDs.
 * @param {string} directory - The directory path requested for deletion. 
 * @param {string} username - The username of the peer.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
const deleteDownloadFolder = async (directory, username) => {
    try {
        if (!username || !directory || directory.trim() === '') return false;
        
        const res = await slskdClient.get(`/api/v0/transfers/downloads/${username}`);
        const directories = res.data.directories || [];
        let filesToDelete = [];
        
        for (const dir of directories) {
            for (const file of (dir.files || [])) {
                if (file.filename === directory || file.filename.startsWith(directory + '\\') || file.filename.startsWith(directory + '/')) {
                    filesToDelete.push(file.id);
                }
            }
        }
        
        if (filesToDelete.length === 0) return false;

        console.log(`[SLSKD] Deleting ${filesToDelete.length} obsolete files for user: ${username}, directory: ${directory}`);
        
        for (const id of filesToDelete) {
            try {
                await slskdClient.delete(`/api/v0/transfers/downloads/${username}/${id}`);
            } catch (err) {
                console.error(`[SLSKD] Error deleting transfer ${id} per ${username}:`, err.message);
            }
        }

        console.log(`[SLSKD] Cleared ${filesToDelete.length} transfers for user: ${username}, directory: ${directory}`);
        return true;
    } catch (error) {
        console.error('[SLSKD] API delete folder failed:', error.message);
        return false;
    }
};

/**
 * Retries specific blocked or failed files for a peer.
 * @param {string} username - The username of the peer.
 * @param {Array} files - The array of file objects to retry.
 * @returns {Promise<boolean>} True if successfully requeued, false otherwise.
 */
const retryDownloadFiles = async (username, files) => {
    try {
        if (!username || !files || files.length === 0) return false;
        
        const filesToDownload = files.map(f => ({ filename: f.filename, size: f.size }));
        await slskdClient.post(`/api/v0/transfers/downloads/${username}`, filesToDownload);
        console.log(`[SLSKD] Requeued ${files.length} failed files for user: ${username}`);
        return true;
    } catch (error) {
        console.error('[SLSKD] API retry files failed:', error.message);
        return false;
    }
};

module.exports = {
    requestDownload,
    checkDownloadStatus,
    deleteDownloadFolder,
    retryDownloadFiles
};