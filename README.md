# Slskd Lidarr Integration

A middleware bridge that connects Lidarr with Slskd (Soulseek) by mocking Torznab indexer endpoints and a qBittorrent-compatible API client. 
This allows you to seamlessly search and download music directly from the Soulseek network using Lidarr's native interface.

## TODO / Future Improvements

- [ ] **Quality Preferences:** Parse and relay Lidarr's specific quality preferences (e.g., FLAC vs 320kbps MP3) to better score and filter Slskd search candidates.
- [ ] **Download Cancellation (Lidarr):** Detect when Lidarr removes a download from its queue, and automatically abort/clean up the corresponding transfer in the Slskd client.
- [ ] **Manual Stops (Slskd):** Detect when a download is manually stopped, paused, or cancelled directly via the Slskd interface, and relay that failure/cancelled state back to Lidarr so it can trigger a fallback search.
- [ ] **Lucida Integration**.