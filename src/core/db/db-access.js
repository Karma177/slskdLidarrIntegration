const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Mettiamo il database in una cartella montabile per Docker
const dataDir = path.join(__dirname, '..', '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'database.sqlite');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new DatabaseSync(dbPath);

// Applica lo schema di base
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Utility methods
const dbManager = {
    // --- SETTINGS ---
    getSetting(key) {
        const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
        const row = stmt.get(key);
        return row ? row.value : null;
    },
    setSetting(key, value) {
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run(key, value);
    },

    // --- APIS ---
    getApi(service) {
        const stmt = db.prepare('SELECT * FROM apis WHERE service = ?');
        return stmt.get(service);
    },
    updateApi(service, apiKey, apiUrl) {
        const stmt = db.prepare('INSERT OR REPLACE INTO apis (service, api_key, api_url) VALUES (?, ?, ?)');
        stmt.run(service, apiKey, apiUrl);
    },

    // --- LOGINS ---
    getLogin(service) {
        const stmt = db.prepare('SELECT * FROM logins WHERE service = ?');
        return stmt.get(service);
    },
    updateLogin(service, username, password, token) {
        const stmt = db.prepare('INSERT OR REPLACE INTO logins (service, username, password, token) VALUES (?, ?, ?, ?)');
        stmt.run(service, username, password, token);
    },

    // --- HISTORY ---
    addHistory(title, artist, album, source, status, errorMessage = null) {
        const stmt = db.prepare(`
            INSERT INTO history (title, artist, album, source, status, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(title, artist, album, source, status, errorMessage);
    },
    getHistory() {
        const stmt = db.prepare('SELECT * FROM history ORDER BY added_at DESC LIMIT 100');
        return stmt.all();
    }
};

module.exports = dbManager;
