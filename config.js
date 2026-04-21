module.exports = {
    webServer: {
        port: process.env.PORT || 8080
    },
    slskd: {
        apiUrl: process.env.SLSKD_API_URL || 'http://localhost:5000/api',
        apiKey: process.env.SLSKD_API_KEY || 'YOUR_SLSKD_API_KEY',
        maxRetries: process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : 3,
        downloadDir: process.env.SLSKD_DOWNLOAD_DIR || '/app/data/downloads'
    },
    lidarr: {
        apiUrl: process.env.LIDARR_API_URL || 'http://localhost:8686/api/v1',
        apiKey: process.env.LIDARR_API_KEY || 'YOUR_LIDARR_API_KEY'
    },
    queryTemplate: process.env.QUERY_TEMPLATE || '{artist} {album}',
    importTimeout: process.env.IMPORT_TIMEOUT ? parseInt(process.env.IMPORT_TIMEOUT, 10) : 120000,
    qualityPreferences: process.env.QUALITY_PREFERENCES ? process.env.QUALITY_PREFERENCES.split(',').map(s => s.trim().toLowerCase()) : ['flac', '320']
};