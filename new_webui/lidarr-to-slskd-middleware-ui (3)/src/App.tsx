import { useState, useEffect, useRef } from 'react';
import { Home, History, Terminal, Settings as SettingsIcon, Info, Moon, Sun, Play, CheckCircle, XCircle, Search, Save, Github, RefreshCw, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import axios from 'axios';

// --- API Helper ---
const api = axios.create({ baseURL: '/' });

// --- Types ---
type ViewState = 'home' | 'history' | 'logs' | 'settings' | 'info';

function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const useAlbumDetails = (artist: string, album: string) => {
  const [details, setDetails] = useState<{artUrl: string | null, releaseYear: string | null}>({ artUrl: null, releaseYear: null });

  useEffect(() => {
    if (!artist || !album || album.includes('Unknown Album')) return;
    const cacheKey = `details_${artist}_${album}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      setDetails(JSON.parse(cached));
      return;
    }
    
    // Strip "Error:" or other tags from album for better search
    let cleanAlbum = album.replace(/^Error:\s*/i, '').replace(/\[.*?\]/g, '').trim();
    const term = encodeURIComponent(`${artist} ${cleanAlbum}`);
    
    fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=1`)
      .then(res => res.json())
      .then(data => {
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          const artUrl = result.artworkUrl100 ? result.artworkUrl100.replace('100x100bb', '300x300bb') : null;
          const releaseYear = result.releaseDate ? result.releaseDate.substring(0, 4) : null;
          const newDetails = { artUrl, releaseYear };
          sessionStorage.setItem(cacheKey, JSON.stringify(newDetails));
          setDetails(newDetails);
        }
      })
      .catch(() => {});
  }, [artist, album]);

  return details;
};

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'history', icon: History, label: 'History' },
    { id: 'logs', icon: Terminal, label: 'Logs' },
    { id: 'settings', icon: SettingsIcon, label: 'Settings' },
    { id: 'info', icon: Info, label: 'Info' },
  ] as const;

  return (
    <div className={`h-screen overflow-hidden flex ${theme === 'dark' ? 'bg-dark-bg text-white' : 'bg-gray-100 text-gray-900'} transition-colors duration-200 font-sans`}>
      {/* Sidebar */}
      <aside className={`w-60 flex flex-col p-4 border-r ${theme === 'dark' ? 'bg-black border-dark-border' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-8 px-4">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-black">
            <Play size={16} className="fill-current" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">SLSK-M</h1>
        </div>
        
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <div
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`sidebar-item ${currentView === item.id ? 'active' : ''} ${theme !== 'dark' && currentView === item.id ? '!bg-gray-200 !text-black' : ''} ${theme !== 'dark' && currentView !== item.id ? 'hover:!bg-gray-100 hover:!text-gray-900 !text-gray-600' : ''}`}
            >
              <item.icon size={20} />
              {item.label}
            </div>
          ))}
        </nav>

        <div className="mt-auto">
          <div 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`sidebar-item ${theme !== 'dark' ? 'hover:!bg-gray-200 !text-gray-600' : ''}`}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 overflow-hidden p-6 flex flex-col ${theme === 'dark' ? 'bg-gradient-to-b from-[#1e1e1e] to-black' : 'bg-white'}`}>
        <div className="h-full overflow-hidden flex-1 w-full max-w-6xl mx-auto flex flex-col">
          {currentView === 'home' && <HomeView theme={theme} />}
          {currentView === 'history' && <HistoryView theme={theme} />}
          {currentView === 'logs' && <LogsView theme={theme} />}
          {currentView === 'settings' && <SettingsView theme={theme} />}
          {currentView === 'info' && <InfoView theme={theme} />}
        </div>
      </main>
    </div>
  );
}

// --- Views ---

function HomeView({ theme }: { theme: 'dark' | 'light' }) {
  const [queue, setQueue] = useState<any[]>([]);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await api.get('/api/queue');
        setQueue(res.data);
      } catch (e) {}
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatName = (query: string) => {
    const parts = query.split('-');
    const artist = parts[0]?.trim() || 'Unknown Artist';
    const rawAlbum = parts.slice(1).join('-').trim() || query;
    return { artist, rawAlbum };
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3] opacity-60">Downloads Overview</h2>
      
      {queue.length === 0 ? (
        <div className={`p-12 text-center flex-1 flex flex-col items-center justify-center ${theme === 'dark' ? 'card' : 'bg-gray-50 border border-gray-200 rounded-lg'}`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-spotify-green/10 flex items-center justify-center">
            <Search className="text-spotify-green" size={32} />
          </div>
          <h3 className="text-xl font-medium mb-1">No active downloads</h3>
          <p className="text-gray-500">Downloads sent by Lidarr will appear here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 flex-1 overflow-y-auto pb-4 items-stretch w-full pt-2">
          {queue.map(item => {
            const { artist, rawAlbum } = formatName(item.query);
            const isError = item.status === 'error' || item.status === 'failed';
            const isDone = item.status === 'completed';
            const isTrack = item.query.toLowerCase().includes('track');
            
            return (
              <HomeListItem 
                key={item.hash} 
                item={item} 
                theme={theme} 
                artist={artist} 
                rawAlbum={rawAlbum} 
                isError={isError} 
                isDone={isDone} 
                isTrack={isTrack} 
              />
            )
          })}
        </div>
      )}
    </div>
  );
}

function HomeListItem({ item, theme, artist, rawAlbum, isError, isDone, isTrack }: any) {
  const { artUrl, releaseYear } = useAlbumDetails(artist, rawAlbum);

  return (
    <div className={`p-4 flex flex-col w-full group ${
      theme === 'dark' ? 'card hover:bg-dark-card-hover' : 'bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow hover:bg-gray-50'
    } ${isError ? (theme === 'dark' ? '!border !border-red-500/50' : '!border-red-500') : isDone ? (theme === 'dark' ? '!border !border-spotify-green/50' : '!border-spotify-green') : ''}`}>
      
      <div className="flex items-center gap-4 w-full">
        <div className="w-14 h-14 bg-[#333] rounded-md flex-shrink-0 flex items-center justify-center relative overflow-hidden shadow-sm">
          {artUrl ? (
            <img src={artUrl} alt="Album Art" className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg font-bold text-white opacity-50">{artist.charAt(0)}</span>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-1">
            <span className={`tag ${isTrack ? 'tag-track' : 'tag-album'} ${theme !== 'dark' && !isTrack ? '!border-gray-400 !text-gray-500' : ''}`}>
              {isTrack ? 'TRACK' : 'ALBUM'}
            </span>
            <span className={`tag border ${theme === 'dark' ? 'border-gray-600 text-gray-400' : 'border-gray-400 text-gray-500'}`}>SLSKD</span>
            <span className={`tag border ${theme === 'dark' ? 'border-blue-500/50 text-blue-400' : 'border-blue-500 text-blue-600'}`}>FLAC</span>
            <p className="font-bold truncate text-base">{rawAlbum}</p>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-sm truncate max-w-[300px] ${theme !== 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>{artist}</span>
            {isDone && <span className="text-xs uppercase tracking-wider font-bold text-spotify-green flex-shrink-0">Completed</span>}
            {isError && <span className="text-xs uppercase tracking-wider font-bold text-red-500 flex-shrink-0" title={item.errorMessage}>Error</span>}
          </div>
          
          {!isDone && (
            <div className="mt-2.5 w-full bg-gray-200 dark:bg-gray-800 h-2 rounded-full overflow-hidden flex items-center relative">
              <div 
                className={`h-full ${isError ? 'bg-red-500' : 'bg-spotify-green'} transition-all duration-300`} 
                style={{ width: `${Math.min(100, Math.max(0, item.progress * 100))}%` }} 
              />
            </div>
          )}
        </div>
        
      <div className="w-auto flex-shrink-0 flex items-center justify-end gap-3 pr-2">
        {!isDone && !isError && (
          <span className={`text-base font-bold spotify-green`}>
            {Math.round(item.progress * 100)}%
          </span>
        )}
        {isError && (
          <div className="flex items-center gap-3">
            <span className={`text-base font-bold text-red-500`}>
              {Math.round(item.progress * 100)}%
            </span>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                fetch(`/api/queue/${item.hash}/retry`, { method: 'POST' });
              }}
              className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/10 text-white/70 hover:text-white' : 'hover:bg-black/5 text-black/60 hover:text-black'} transition-colors cursor-pointer`}
              title="Retry download"
            >
              <RefreshCw size={14} />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                fetch(`/api/queue/${item.hash}`, { method: 'DELETE' });
              }}
              className={`p-2 rounded-full hover:bg-red-500/10 text-red-500/70 hover:text-red-500 transition-colors cursor-pointer`}
              title="Remove from queue"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Expanded Details */}
      <div className="overflow-hidden max-h-0 opacity-0 group-hover:max-h-40 group-hover:opacity-100 transition-all duration-300 ease-in-out">
        <div className={`mt-4 pt-4 border-t flex flex-wrap gap-x-12 gap-y-4 text-xs ${theme === 'dark' ? 'border-dark-border text-gray-300' : 'border-gray-200 text-gray-700'}`}>
          <div className="flex flex-col">
            <span className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Release Year</span>
            <span>{releaseYear || 'Unknown'}</span>
          </div>
          <div className="flex flex-col">
            <span className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Agent</span>
            <span>Slskd</span>
          </div>
          <div className="flex flex-col">
            <span className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Downloaded</span>
            <span>{formatBytes(item.downloadedSize)} / {formatBytes(item.totalSize)}</span>
          </div>
          {item.errorMessage && (
            <div className="flex flex-col w-full">
              <span className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Error details</span>
              <span className="text-red-500">{item.errorMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryView({ theme }: { theme: 'dark' | 'light' }) {
  const [history, setHistory] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');

  const fetchHistory = async () => {
    try {
      const res = await api.get('/api/history', { params: { filter } });
      setHistory(res.data || []);
    } catch (e) {
      console.error('Error fetching history:', e);
      setHistory([]);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [filter]);

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3] opacity-60">History & Logs</h2>
        <div className={`flex items-center gap-1 p-1 rounded ${theme === 'dark' ? 'bg-[#282828]' : 'bg-gray-200'}`}>
          {['all', 'success', 'failed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-bold rounded uppercase transition-colors ${
                filter === f 
                  ? `${theme === 'dark' ? 'bg-[#3E3E3E] text-white' : 'bg-white text-black shadow-sm'}`
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 overflow-auto rounded ${theme === 'dark' ? 'card' : 'bg-white border border-gray-200 shadow-sm'}`}>
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className={theme === 'dark' ? 'text-[#B3B3B3] font-bold uppercase tracking-wider text-[11px] border-b border-dark-border' : 'bg-gray-50 border-b border-gray-200 text-gray-500 uppercase text-[11px] font-bold tracking-wider'}>
              <th className="p-4">Query</th>
              <th className="p-4">Date</th>
              <th className="p-4">Status</th>
              <th className="p-4">Details</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${theme === 'dark' ? 'divide-dark-border' : 'divide-gray-100'}`}>
            {history.map((row) => (
              <HistoryTableRow key={row.id} row={row} theme={theme} />
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-[#B3B3B3]">No history found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryTableRow({ row, theme }: any) {
  const parts = row.query.split('-');
  const artist = parts[0]?.trim() || 'Unknown Artist';
  const rawAlbum = parts.slice(1).join('-').trim() || row.query;
  const { artUrl, releaseYear } = useAlbumDetails(artist, rawAlbum);

  return (
    <tr className={`group ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-gray-50 transition-colors'}`}>
      <td className="p-4 font-semibold truncate max-w-xs relative" title={row.query}>
        <div className="flex items-center gap-3">
          {artUrl ? (
            <img src={artUrl} alt="Cover" className="w-8 h-8 rounded object-cover shadow-sm bg-black/50 flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 bg-[#333] rounded flex items-center justify-center flex-shrink-0">
              <span className="text-white opacity-50 font-bold text-xs">{artist.charAt(0)}</span>
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <span className="truncate">{row.query}</span>
            {releaseYear && <span className={`text-[10px] uppercase font-bold tracking-wider ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>{releaseYear}</span>}
          </div>
        </div>
      </td>
      <td className="p-4 text-[#B3B3B3]">
        {row.timestamp ? format(new Date(row.timestamp.replace(' ', 'T') + 'Z'), 'MMM d, yyyy HH:mm') : '-'}
      </td>
      <td className="p-4">
        {row.status === 'success' ? (
          <span className="inline-flex items-center gap-1 tracking-wider uppercase text-[10px] font-bold spotify-green"><CheckCircle size={12}/> SUCCESS</span>
        ) : (
          <span className="inline-flex items-center gap-1 tracking-wider uppercase text-[10px] font-bold text-red-500"><XCircle size={12}/> FAILED</span>
        )}
      </td>
      <td className="p-4 text-[#B3B3B3] max-w-xs truncate text-[12px]" title={row.errorMessage}>
        {row.errorMessage || '-'}
      </td>
    </tr>
  );
}

function LogsView({ theme }: { theme: 'dark' | 'light' }) {
  const [logs, setLogs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      const res = await api.get('/api/logs');
      setLogs(res.data);
    };
    fetchLogs();
    const int = setInterval(fetchLogs, 2000);
    return () => clearInterval(int);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full gap-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3] opacity-60 flex-shrink-0">Terminals & Logs</h2>
      <div 
        ref={scrollRef}
        className={`flex-1 overflow-y-auto ${theme === 'dark' ? 'terminal' : 'bg-gray-50 border border-gray-200 rounded p-4 font-mono text-[11px] text-gray-800'}`}
      >
        {logs.map((log, i) => {
          let colorClass = theme === 'dark' ? 'text-white/50' : 'text-gray-500';
          const lowerLog = log.toLowerCase();
          if (lowerLog.includes('error') || lowerLog.includes('failed') || log.includes('[ERROR]')) colorClass = theme === 'dark' ? 'text-red-500' : 'text-red-600 font-bold';
          else if (lowerLog.includes('warn') || log.includes('[WARN]')) colorClass = theme === 'dark' ? 'text-yellow-500' : 'text-yellow-600 font-bold';
          else if (log.includes('[SLSKD]')) colorClass = theme === 'dark' ? 'text-white' : 'text-gray-900';
          else if (log.includes('[QBI]')) colorClass = theme === 'dark' ? 'text-blue-300' : 'text-blue-600';
          else if (log.includes('[OK]')) colorClass = theme === 'dark' ? 'spotify-green' : 'text-green-600 font-bold';

          return (
            <div key={i} className={`whitespace-pre-wrap ${colorClass}`}>
              {log}
            </div>
          );
        })}
        {logs.length === 0 && <span className="opacity-50">Waiting for logs...</span>}
        <div className="animate-pulse">_</div>
      </div>
    </div>
  );
}

function SettingsView({ theme }: { theme: 'dark' | 'light' }) {
  const [settings, setSettings] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/settings').then(res => setSettings(res.data));
  }, []);

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    setSettings((s: any) => ({ ...s, [name]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    await api.post('/api/settings', settings);
    setTimeout(() => setSaving(false), 800);
  };

  const inputClassTheme = theme === 'dark' ? 'input-dark' : 'w-full p-2 bg-white border border-gray-300 rounded text-[13px] outline-none focus:border-spotify-green';
  const labelClassTheme = theme === 'dark' ? 'input-label' : 'text-gray-700 text-[11px] font-bold uppercase tracking-wider mb-1 block';

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[#B3B3B3] opacity-60">Configuration Quick View</h2>
        <button 
          onClick={handleSave}
          className="flex items-center gap-2 bg-spotify-green hover:bg-[#1ed760] text-black font-bold uppercase tracking-wide text-xs px-4 py-2 rounded-full transition-all active:scale-95"
        >
          {saving ? <CheckCircle size={14} /> : <Save size={14} />}
          {saving ? 'Saved' : 'Save'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0 overflow-y-auto w-full pb-10 content-start">
        {/* API Settings */}
        <section className={`p-4 flex flex-col gap-4 ${theme === 'dark' ? 'card' : 'bg-gray-50 border border-gray-200 rounded lg:col-span-1'}`}>
          <h3 className="text-[13px] font-bold border-b pb-2 mb-2 uppercase tracking-wide border-dark-border" style={{ borderColor: theme !== 'dark' ? '#eee' : undefined}}>API Connections</h3>
          <div className="space-y-4">
            <div>
              <label className={labelClassTheme}>Lidarr API URL</label>
              <input type="text" name="lidarrApiUrl" value={settings.lidarrApiUrl || ''} onChange={handleChange} className={inputClassTheme} />
            </div>
            <div>
              <label className={labelClassTheme}>Lidarr API Key</label>
              <input type="password" name="lidarrApiKey" value={settings.lidarrApiKey || ''} onChange={handleChange} className={inputClassTheme} placeholder="Enter your key" />
            </div>
            <div>
              <label className={labelClassTheme}>Slskd API URL</label>
              <input type="text" name="slskdApiUrl" value={settings.slskdApiUrl || ''} onChange={handleChange} className={inputClassTheme} />
            </div>
            <div>
              <label className={labelClassTheme}>Slskd API Key</label>
              <input type="password" name="slskdApiKey" value={settings.slskdApiKey || ''} onChange={handleChange} className={inputClassTheme} placeholder="Enter your key" />
            </div>
          </div>
        </section>

        {/* Behavior Settings */}
        <section className={`p-4 flex flex-col gap-4 ${theme === 'dark' ? 'card' : 'bg-gray-50 border border-gray-200 rounded lg:col-span-1'}`}>
          <h3 className="text-[13px] font-bold border-b pb-2 mb-2 uppercase tracking-wide border-dark-border" style={{ borderColor: theme !== 'dark' ? '#eee' : undefined}}>Download Behavior</h3>
          <div className="space-y-4">
            <div>
              <label className={labelClassTheme}>
                Query Format
              </label>
              <input type="text" name="queryFormat" value={settings.queryFormat || ''} onChange={handleChange} className={inputClassTheme} placeholder="{artist} {album} {track} {year}" />
            </div>
            
            <div>
              <label className={labelClassTheme}>
                Quality Preference
              </label>
              <input type="text" name="qualityPreferences" value={settings.qualityPreferences || ''} onChange={handleChange} className={inputClassTheme} placeholder="flac 44, flac 48, mp3" />
            </div>

            <div>
              <label className={labelClassTheme}>Slskd Download Path</label>
              <input type="text" name="downloadPath" value={settings.downloadPath || ''} onChange={handleChange} className={inputClassTheme} placeholder="/app/data/downloads" />
            </div>
            
            <div>
              <label className={labelClassTheme}>Import Timeout (ms)</label>
              <input type="number" name="importTimeout" value={settings.importTimeout || ''} onChange={handleChange} className={inputClassTheme} />
            </div>

            <div>
              <label className={labelClassTheme}>Primary Downloader</label>
              <select name="primaryDownloader" value={settings.primaryDownloader || 'slskd'} onChange={handleChange} className={inputClassTheme}>
                <option value="slskd">Slskd</option>
                <option value="lucida">Lucida</option>
              </select>
            </div>
            <div>
              <label className={labelClassTheme}>Fallback Downloader</label>
              <select name="fallbackDownloader" value={settings.fallbackDownloader || 'none'} onChange={handleChange} className={inputClassTheme}>
                <option value="none">None</option>
                <option value="slskd">Slskd</option>
                <option value="lucida">Lucida</option>
              </select>
            </div>
            
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoView({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto text-center gap-6">
      <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-black">
        <Play size={32} className="fill-current ml-1" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">SLSK-M</h2>
        <p className={`text-sm ${theme === 'dark' ? 'text-[#B3B3B3]' : 'text-gray-500'} font-medium`}>
          A smart middleware that connects Lidarr's download client capabilities seamlessly with the Soulseek network via Slskd.
        </p>
      </div>
      <a 
        href="https://github.com/your-repo/lidarr-slskd" 
        target="_blank" 
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-full bg-white text-black font-bold uppercase tracking-wider text-xs hover:scale-105 transition-transform"
      >
        <Github size={16} />
        View on GitHub
      </a>
    </div>
  );
}

