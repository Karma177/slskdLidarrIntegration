import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT,
    query TEXT,
    status TEXT,
    errorMessage TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export const getSettings = () => {
  const rows = db.prepare('SELECT * FROM settings').all() as any[];
  const settings = {
    queryFormat: '{artist} {album}',
    qualityPreferences: 'flac 44, flac 48, mp3',
    lidarrApiKey: '',
    lidarrApiUrl: 'http://localhost:8686',
    slskdApiKey: '',
    slskdApiUrl: 'http://localhost:5030',
    importTimeout: '600000',
    downloadPath: '/app/data/downloads',
    primaryDownloader: 'slskd',
    fallbackDownloader: 'none'
  };
  rows.forEach(row => {
    (settings as any)[row.key] = row.value;
  });
  return settings;
};

export const saveSettings = (newSettings: any) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((settingsObj: any) => {
    for (const [key, value] of Object.entries(settingsObj)) {
      stmt.run(key, String(value));
    }
  });
  tx(newSettings);
};

export const addToHistory = (hash: string, query: string, status: string, errorMessage: string = '') => {
  db.prepare('INSERT INTO history (hash, query, status, errorMessage) VALUES (?, ?, ?, ?)').run(hash, query, status, errorMessage);
};

export const getHistory = (filterStatus?: string) => {
  if (filterStatus && filterStatus !== 'all') {
    return db.prepare('SELECT * FROM history WHERE status = ? ORDER BY timestamp DESC').all(filterStatus);
  }
  return db.prepare('SELECT * FROM history ORDER BY timestamp DESC').all();
};

export const clearHistory = () => {
  db.prepare('DELETE FROM history').run();
};

export default db;
