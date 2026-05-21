/**
 * YouTube Music module for Shirox / NEPAX
 * Uses the public InnerTube API (same backend as https://music.youtube.com/)
 */

const YTM_HOST = "https://music.youtube.com";
const YTM_API = YTM_HOST + "/youtubei/v1";
const YT_WATCH = "https://music.youtube.com/watch?v=";

const CLIENT_VERSION = "1.20241106.01.00";
let cachedVisitorId = null;

function visitorId() {
    if (!cachedVisitorId) {
        const hex = "0123456789abcdef";
        cachedVisitorId = Array.from({ length: 16 }, () => hex[Math.floor(Math.random() * 16)]).join("");
    }
    return cachedVisitorId;
}

function ytmContext() {
    return {
        client: {
            clientName: "WEB_REMIX",
            clientVersion: CLIENT_VERSION,
            hl: "en",
            gl: "US",
            originalUrl: YTM_HOST
        },
        user: {
            lockedSafetyMode: false
        }
    };
}

async function ytmPost(endpoint, payload) {
    const body = {
        context: ytmContext(),
        ...payload
    };
    const response = await soraFetch(`${YTM_API}/${endpoint}?prettyPrint=false`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Origin": YTM_HOST,
            "Referer": YTM_HOST + "/",
            "X-Goog-Visitor-Id": visitorId()
        },
        body: JSON.stringify(body)
    });
    return await response.json();
}

function textFromRuns(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (node.simpleText) return String(node.simpleText);
    if (node.runs && Array.isArray(node.runs)) {
        return node.runs.map((r) => r.text || "").join("").trim();
    }
    return "";
}

function bestThumbnail(thumbnails) {
    if (!thumbnails || !thumbnails.length) return "";
    const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    return sorted[0].url || "";
}

function extractVideoId(url) {
    const m = String(url).match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[&?#/]|$)/);
    return m ? m[1] : null;
}

function extractBrowseId(url) {
    const m = String(url).match(/\/browse\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

function extractPlaylistId(url) {
    const m = String(url).match(/[?&]list=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

function playlistToBrowseId(playlistId) {
    if (!playlistId) return null;
    if (playlistId.startsWith("VL")) return playlistId;
    if (playlistId.startsWith("PL")) return "VL" + playlistId;
    if (playlistId.startsWith("RD")) return "VL" + playlistId;
    return "VL" + playlistId;
}

function hrefForNavigation(nav) {
    if (!nav) return null;
    if (nav.watchEndpoint && nav.watchEndpoint.videoId) {
        return YT_WATCH + nav.watchEndpoint.videoId;
    }
    if (nav.watchPlaylistEndpoint && nav.watchPlaylistEndpoint.playlistId) {
        const pid = nav.watchPlaylistEndpoint.playlistId;
        return `${YTM_HOST}/playlist?list=${pid}`;
    }
    if (nav.browseEndpoint) {
        const bid = nav.browseEndpoint.browseId;
        if (bid) return `${YTM_HOST}/browse/${bid}`;
    }
    return null;
}

function parseResponsiveListItem(renderer, out, seen) {
    const nav =
        renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.navigationEndpoint
        || renderer.navigationEndpoint
        || renderer.menu?.menuRenderer?.items?.[0]?.menuNavigationItemRenderer?.navigationEndpoint;

    const href = hrefForNavigation(nav);
    if (!href || seen.has(href)) return;

    let title = "";
    const cols = renderer.flexColumns || [];
    if (cols.length > 0) {
        title = textFromRuns(cols[0].musicResponsiveListItemFlexColumnRenderer?.text);
    }
    if (!title) title = textFromRuns(renderer.headline);

    const thumbs =
        renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || renderer.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails
        || [];

    seen.add(href);
    out.push({
        title: title || "Unknown",
        image: bestThumbnail(thumbs),
        href
    });
}

function parseTwoRowItem(renderer, out, seen) {
    const nav = renderer.navigationEndpoint;
    const href = hrefForNavigation(nav);
    if (!href || seen.has(href)) return;

    const title = textFromRuns(renderer.title) || textFromRuns(renderer.headline);
    const thumbs =
        renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || [];

    seen.add(href);
    out.push({
        title: title || "Unknown",
        image: bestThumbnail(thumbs),
        href
    });
}

function walkCollectSearch(node, out, seen) {
    if (!node || typeof node !== "object") return;
    if (node.musicResponsiveListItemRenderer) {
        parseResponsiveListItem(node.musicResponsiveListItemRenderer, out, seen);
    }
    if (node.musicTwoRowItemRenderer) {
        parseTwoRowItem(node.musicTwoRowItemRenderer, out, seen);
    }
    if (Array.isArray(node)) {
        for (const item of node) walkCollectSearch(item, out, seen);
        return;
    }
    for (const key of Object.keys(node)) {
        walkCollectSearch(node[key], out, seen);
    }
}

async function searchResults(keyword) {
    try {
        const query = String(keyword || "").trim();
        if (!query) return JSON.stringify([]);

        const data = await ytmPost("search", {
            query,
            params: "EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D"
        });

        const results = [];
        const seen = new Set();
        walkCollectSearch(data, results, seen);

        return JSON.stringify(results.slice(0, 40));
    } catch (error) {
        console.log("YTM searchResults error: " + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const videoId = extractVideoId(url);
        if (videoId) {
            const data = await ytmPost("player", { videoId });
            const title =
                data?.videoDetails?.title
                || data?.microformat?.playerMicroformatRenderer?.title?.simpleText
                || "Track";
            const author =
                data?.videoDetails?.author
                || data?.microformat?.playerMicroformatRenderer?.ownerChannelName
                || "";
            return JSON.stringify([{
                description: title,
                aliases: author ? `Artist: ${author}` : "",
                airdate: ""
            }]);
        }
        return JSON.stringify([{
            description: "YouTube Music",
            aliases: "",
            airdate: ""
        }]);
    } catch (error) {
        console.log("YTM extractDetails error: " + error);
        return JSON.stringify([{
            description: "YouTube Music",
            aliases: "",
            airdate: ""
        }]);
    }
}

function walkCollectTracks(node, tracks, seen) {
    if (!node || typeof node !== "object") return;
    if (node.musicResponsiveListItemRenderer) {
        const r = node.musicResponsiveListItemRenderer;
        const nav =
            r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.navigationEndpoint
            || r.navigationEndpoint;
        const videoId = nav?.watchEndpoint?.videoId;
        if (videoId && !seen.has(videoId)) {
            seen.add(videoId);
            tracks.push({
                number: tracks.length + 1,
                href: YT_WATCH + videoId
            });
        }
    }
    if (Array.isArray(node)) {
        for (const item of node) walkCollectTracks(item, tracks, seen);
        return;
    }
    for (const key of Object.keys(node)) {
        walkCollectTracks(node[key], tracks, seen);
    }
}

async function fetchTracksFromBrowse(browseId) {
    const data = await ytmPost("browse", { browseId });
    const tracks = [];
    const seen = new Set();
    walkCollectTracks(data, tracks, seen);
    return tracks.map((t, i) => ({ number: i + 1, href: t.href }));
}

async function extractEpisodes(url) {
    try {
        const videoId = extractVideoId(url);
        if (videoId) {
            return JSON.stringify([{ number: 1, href: url }]);
        }

        const playlistId = extractPlaylistId(url);
        if (playlistId) {
            const browseId = playlistToBrowseId(playlistId);
            const tracks = await fetchTracksFromBrowse(browseId);
            if (tracks.length) return JSON.stringify(tracks);
        }

        const browseId = extractBrowseId(url);
        if (browseId) {
            const tracks = await fetchTracksFromBrowse(browseId);
            return JSON.stringify(tracks);
        }

        return JSON.stringify([]);
    } catch (error) {
        console.log("YTM extractEpisodes error: " + error);
        return JSON.stringify([]);
    }
}

function pickBestAudioFormat(formats) {
    if (!formats || !formats.length) return null;
    const audio = formats.filter((f) => {
        const mime = (f.mimeType || "").toLowerCase();
        return mime.startsWith("audio/") && f.url;
    });
    if (!audio.length) return null;
    audio.sort((a, b) => (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0));
    return audio[0];
}

async function extractStreamUrl(url) {
    try {
        const videoId = extractVideoId(url);
        if (!videoId) {
            return JSON.stringify({ streams: [] });
        }

        const data = await ytmPost("player", {
            videoId,
            contentCheckOk: true
        });

        const streaming = data.streamingData || {};
        const formats = [
            ...(streaming.adaptiveFormats || []),
            ...(streaming.formats || [])
        ];

        const best = pickBestAudioFormat(formats);
        if (!best || !best.url) {
            return JSON.stringify({ streams: [] });
        }

        const quality = best.audioQuality || best.quality || "audio";
        const mime = (best.mimeType || "").split(";")[0];
        const title = `${quality} · ${mime || "audio"}`;

        return JSON.stringify({
            streams: [{
                title,
                streamUrl: best.url,
                headers: {
                    Referer: "https://www.youtube.com/",
                    Origin: "https://www.youtube.com"
                }
            }]
        });
    } catch (error) {
        console.log("YTM extractStreamUrl error: " + error);
        return JSON.stringify({ streams: [] });
    }
}
