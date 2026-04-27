CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS apis (
    service TEXT PRIMARY KEY,
    api_key TEXT,
    api_url TEXT
);

CREATE TABLE IF NOT EXISTS logins (
    service TEXT PRIMARY KEY,
    username TEXT,
    password TEXT,
    token TEXT
);

CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    artist TEXT,
    album TEXT,
    source TEXT,
    status TEXT,
    error_message TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Inseriamo i valori di default se non esistono
INSERT OR IGNORE INTO settings (key, value) VALUES ('fallback_order', 'slskd,tidal,qobuz,spotify');
INSERT OR IGNORE INTO settings (key, value) VALUES ('import_timeout', '120000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_retries', '3');
INSERT OR IGNORE INTO settings (key, value) VALUES ('query_template', '{artist} {album}');
INSERT OR IGNORE INTO settings (key, value) VALUES ('slskd_download_dir', '/slskd_downloads');
INSERT OR IGNORE INTO settings (key, value) VALUES ('quality_preferences', 'flac 44, flac 48, flac, 320, mp3');
INSERT OR IGNORE INTO settings (key, value) VALUES ('port', '8080');

INSERT OR IGNORE INTO apis (service, api_key, api_url) VALUES ('slskd', '', 'http://localhost:5030');
INSERT OR IGNORE INTO apis (service, api_key, api_url) VALUES ('lidarr', '', 'http://localhost:8686/api/v1');

INSERT OR IGNORE INTO logins (service, username, password, token) VALUES ('tidal', '', '', '');
INSERT OR IGNORE INTO logins (service, username, password, token) VALUES ('qobuz', '', '', '');
INSERT OR IGNORE INTO logins (service, username, password, token) VALUES ('spotify', '', '', '');
