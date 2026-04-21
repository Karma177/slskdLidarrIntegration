const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../../config');

/**
 * Generates the Torznab capabilities XML.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleCaps(res) {
    const capsXml = `<?xml version="1.0" encoding="UTF-8"?>
        <caps>
            <server version="1.0" title="Slskd Torznab Proxy"/>
            <searching>
                <search available="yes" supportedParams="q"/>
                <tv-search available="no"/>
                <movie-search available="no"/>
                <music-search available="yes" supportedParams="q,artist,album,year"/>
                <audio-search available="yes" supportedParams="q,artist,album,year"/>
            </searching>
            <categories>
                <category id="3000" name="Audio">
                    <subcat id="3010" name="Audio/Releases"/>
                    <subcat id="3020" name="Audio/Video"/>
                    <subcat id="3030" name="Audio/Audiobook"/>
                    <subcat id="3040" name="Audio/Lossless"/>
                </category>
            </categories>
        </caps>`;
    return res.send(capsXml);
}

/**
 * Generates a dummy Torznab response for empty RSS sync queries to satisfy Lidarr's checks.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleEmptySearch(res) {
    const pubDate = new Date().toUTCString();
    const fakeHash = crypto.createHash('sha1').update('dummy' + Date.now()).digest('hex');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2.0/torznab">
                <channel>
                    <title>Slskd Proxy</title>
                    <description>Recent Releases</description>
                    <language>en-us</language>
                    <pubDate>${pubDate}</pubDate>
                    <item>
                        <title>Slskd Dummy Sync Release [FLAC]</title>
                        <guid>${fakeHash}</guid>
                        <link>magnet:?xt=urn:btih:${fakeHash}&amp;dn=dummy</link>
                        <enclosure url="magnet:?xt=urn:btih:${fakeHash}&amp;dn=dummy" type="application/x-bittorrent" length="500000000"/>
                        <pubDate>${pubDate}</pubDate>
                        <size>500000000</size>
                        <category>3000</category>
                        <category>3040</category>
                        <torznab:attr name="category" value="3000"/>
                        <torznab:attr name="category" value="3040"/>
                        <torznab:attr name="size" value="500000000"/>
                        <torznab:attr name="seeders" value="100"/>
                        <torznab:attr name="peers" value="100"/>
                        <torznab:attr name="downloadvolumefactor" value="0"/>
                        <torznab:attr name="uploadvolumefactor" value="1"/>
                    </item>
                </channel>
            </rss>`;
    return res.send(xml);
}

/**
 * Processes an active search query from Lidarr and returns a mocked Torznab result.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleActiveSearch(req, res) {
    const { q, artist = '', album = '', title = '', year } = req.query;
    
    let rawString = q ? q : `${artist} ${album} ${title}`.trim();
    rawString = rawString.replace(/\s+/g, ' ');

    let networkQuery = rawString;
    
    if (artist || album) {
        let template = config.queryTemplate || '{artist} {album}';
        networkQuery = template
            .replace('{artist}', artist)
            .replace('{album}', album)
            .replace('{title}', title)
            .replace(/\s+/g, ' ')
            .trim();
    } else if (q) {
        networkQuery = q.trim();
    }
    
    const fakeHash = crypto.createHash('sha1').update(rawString + Date.now()).digest('hex');
    const magicPayload = encodeURIComponent(`${rawString}|||${networkQuery}`);
    const magnetLink = `magnet:?xt=urn:btih:${fakeHash}&amp;dn=SLSKD-MAGIC_${magicPayload}&amp;tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337`;

    const sizeBytes = 500000000;
    const pubDate = new Date().toUTCString();
    
    const safeArtist = artist.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeAlbum = album.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeQ = q ? q.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    
    let cleanReleaseTitle = '';
    const yearStr = year ? ` (${year})` : '';

    if (safeArtist && safeAlbum) {
        cleanReleaseTitle = `${safeArtist} - ${safeAlbum}${yearStr} [FLAC]`;
    } else if (safeQ) {
        cleanReleaseTitle = `${safeQ} ${yearStr} [FLAC]`.trim();
    } else {
        cleanReleaseTitle = `Unknown Release${yearStr} [FLAC]`;
    }

    const searchXml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2.0/torznab">
            <channel>
                <title>Slskd Proxy</title>
                <description>Dynamic Soulseek Injector</description>
                <item>
                    <title>${cleanReleaseTitle}</title>
                    <guid>${fakeHash}</guid>
                    <link>${magnetLink}</link>
                    <enclosure url="${magnetLink}" type="application/x-bittorrent" length="${sizeBytes}"/>
                    <pubDate>${pubDate}</pubDate>
                    <size>${sizeBytes}</size>
                    <category>3000</category>
                    <category>3040</category>
                    <torznab:attr name="category" value="3000"/>
                    <torznab:attr name="category" value="3040"/>
                    <torznab:attr name="size" value="${sizeBytes}"/>
                    <torznab:attr name="artist" value="${safeArtist}"/>
                    <torznab:attr name="album" value="${safeAlbum}"/>
                    <torznab:attr name="seeders" value="100"/>
                    <torznab:attr name="peers" value="100"/>
                    <torznab:attr name="downloadvolumefactor" value="0"/>
                    <torznab:attr name="uploadvolumefactor" value="1"/>
                </item>
            </channel>
        </rss>`;

    return res.send(searchXml);
}

/**
 * Generates an empty fallback RSS feed.
 * @param {import('express').Response} res - The Express response object.
 * @returns {void}
 */
function handleFallback(res) {
    const pubDate = new Date().toUTCString();
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2.0/torznab">
        <channel>
            <title>Fallback</title>
            <description>Fallback RSS</description>
            <language>en-us</language>
            <pubDate>${pubDate}</pubDate>
        </channel>
    </rss>`);
}

/**
 * GET /api
 * Main Torznab endpoint for Lidarr queries.
 */
router.get('/api', (req, res) => {
    const { t, q, artist, album, title } = req.query;

    console.log(`[Torznab] Incoming query type: ${t}, query: "${q || 'none'}"`);

    res.set('Content-Type', 'application/rss+xml');

    if (t === 'caps') {
        return handleCaps(res);
    }

    if (t === 'search' || t === 'musicsearch' || t === 'audiosearch' || t === 'music') {
        if (!q && !artist && !album && !title) {
            return handleEmptySearch(res);
        }
        return handleActiveSearch(req, res);
    }

    return handleFallback(res);
});

module.exports = router;