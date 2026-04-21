let logsInterval = null;
let queueInterval = null;

async function fetchLogs() {
    try {
        const response = await fetch('/api/logs');
        const text = await response.text();
        const logsDiv = document.getElementById('logs-container');
        if (!logsDiv) return;
        
        const isScrolledToBottom = logsDiv.scrollHeight - logsDiv.clientHeight <= logsDiv.scrollTop + 1;
        
        logsDiv.textContent = text;
        
        if (isScrolledToBottom) {
            logsDiv.scrollTop = logsDiv.scrollHeight;
        }
    } catch (e) {
        console.error("Failed to fetch logs:", e);
    }
}

async function fetchQueue() {
    try {
        const response = await fetch('/api/v2/torrents/info');
        const torrents = await response.json();
        const container = document.getElementById('queue-container');
        if (!container) return;
        
        if (torrents.length === 0) {
            container.innerHTML = '<p>No active downloads.</p>';
            return;
        }
        
        let html = '<table class="queue-table"><thead><tr><th>Artist</th><th>Album</th><th>Status</th><th>Progress</th><th>Size</th></tr></thead><tbody>';
        torrents.forEach(torrent => {
            // Parse artist and album from the name
            let artist = 'Unknown Artist';
            let album = 'Unknown Album';
            let status = torrent.state;
            
            // Check if it's an error state first
            if (torrent.name && torrent.name.includes('[SLSKD ERROR:')) {
                // Extract error message from the name
                const errorMatch = torrent.name.match(/\[SLSKD ERROR: (.+?)\]/);
                if (errorMatch) {
                    const errorMessage = errorMatch[1];
                    // Show error in status column, not in album name
                    status = `Error: ${errorMessage}`;
                    // Extract the original name without the error prefix
                    const originalName = torrent.name.replace(/\[SLSKD ERROR: .+?\] /, '');
                    // Try to parse artist and album from the original name
                    if (originalName) {
                        const nameParts = originalName.split(' - ');
                        if (nameParts.length >= 2) {
                            artist = nameParts[0];
                            album = nameParts.slice(1).join(' - ');
                        } else {
                            // If no dash, try to split by space and assume first part is artist
                            const spaceParts = originalName.split(' ');
                            if (spaceParts.length > 1) {
                                artist = spaceParts[0];
                                album = spaceParts.slice(1).join(' ');
                            }
                        }
                    }
                }
            } else if (torrent.name) {
                // Try to parse artist and album from the name
                const nameParts = torrent.name.split(' - ');
                if (nameParts.length >= 2) {
                    artist = nameParts[0];
                    album = nameParts.slice(1).join(' - ');
                } else {
                    // If no dash, try to split by space and assume first part is artist
                    const spaceParts = torrent.name.split(' ');
                    if (spaceParts.length > 1) {
                        artist = spaceParts[0];
                        album = spaceParts.slice(1).join(' ');
                    }
                }
            }
            
            html += `<tr>
                <td>${artist}</td>
                <td>${album}</td>
                <td>${status}</td>
                <td>${Math.round(torrent.progress * 100)}%</td>
                <td>${formatBytes(torrent.size)}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        console.error("Failed to fetch queue:", e);
        document.getElementById('queue-container').innerHTML = '<p>Error loading queue data.</p>';
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function switchView(target) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    const view = document.getElementById(target);
    const navItem = document.querySelector(`.nav-item[data-target="${target}"]`);
    
    if (view && navItem) {
        view.classList.add('active');
        navItem.classList.add('active');
    }

    if (target === 'logs') {
        fetchLogs();
        if (!logsInterval) {
            logsInterval = setInterval(fetchLogs, 2000);
        }
    } else {
        if (logsInterval) {
            clearInterval(logsInterval);
            logsInterval = null;
        }
    }
    
    if (target === 'home') {
        fetchQueue();
        if (!queueInterval) {
            queueInterval = setInterval(fetchQueue, 5000);
        }
    } else {
        if (queueInterval) {
            clearInterval(queueInterval);
            queueInterval = null;
        }
    }
}

window.onload = () => {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            switchView(e.target.getAttribute('data-target'));
        });
    });

    switchView('home');
};
