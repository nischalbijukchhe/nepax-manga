/**
 * YouTube Music module for Shirox / NEPAX
 * Uses the public InnerTube API (same backend as https://music.youtube.com/)
 */

const YTM_HOST = "https://music.youtube.com";
const YTM_API = YTM_HOST + "/youtubei/v1";
const YT_WATCH = "https://music.youtube.com/watch?v=";
const YT_API_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

let cachedVisitorId = null;

function visitorId() {
    if (!cachedVisitorId) {
        const hex = "0123456789abcdef";
        cachedVisitorId = Array.from({ length: 16 }, () => hex[Math.floor(Math.random() * 16)]).join("");
    }
    return cachedVisitorId;
}

function ytmContextWeb() {
    return {
        client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20241106.01.00",
            hl: "en",
            gl: "US",
            originalUrl: YTM_HOST
        },
        user: { lockedSafetyMode: false }
    };
}

function ytmContextAndroidMusic() {
    return {
        client: {
            clientName: "ANDROID_MUSIC",
            clientVersion: "7.27.52",
            androidSdkVersion: 34,
            hl: "en",
            gl: "US",
            userAgent: "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14) gzip"
        },
        user: { lockedSafetyMode: false }
    };
}

function ytmContextAndroid() {
    return {
        client: {
            clientName: "ANDROID",
            clientVersion: "19.45.36",
            androidSdkVersion: 34,
            hl: "en",
            gl: "US",
            userAgent: "com.google.android.youtube/19.45.36 (Linux; U; Android 14) gzip"
        },
        user: { lockedSafetyMode: false }
    };
}

function ytmContextIOS() {
    return {
        client: {
            clientName: "IOS",
            clientVersion: "19.45.4",
            deviceModel: "iPhone16,2",
            hl: "en",
            gl: "US",
            userAgent: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1 like Mac OS X)"
        },
        user: { lockedSafetyMode: false }
    };
}

function ytmContextTV() {
    return {
        client: {
            clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
            clientVersion: "2.0",
            hl: "en",
            gl: "US"
        },
        thirdParty: { embedUrl: "https://www.youtube.com" },
        user: { lockedSafetyMode: false }
    };
}

const PLAYER_CLIENTS = [
    { name: "ANDROID_MUSIC", ctx: ytmContextAndroidMusic },
    { name: "ANDROID", ctx: ytmContextAndroid },
    { name: "IOS", ctx: ytmContextIOS },
    { name: "TV_EMBED", ctx: ytmContextTV },
    { name: "WEB_REMIX", ctx: ytmContextWeb }
];

async function ytmPost(endpoint, payload, contextFactory) {
    const ctx = (contextFactory || ytmContextWeb)();
    const body = { context: ctx, ...payload };
    const url = `${YTM_API}/${endpoint}?key=${YT_API_KEY}&prettyPrint=false`;
    const response = await soraFetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Origin": YTM_HOST,
            "Referer": YTM_HOST + "/",
            "X-Goog-Api-Key": YT_API_KEY,
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

function inferMusicType(href, sectionTitle) {
    const section = String(sectionTitle || "").toLowerCase();
    if (section.includes("album")) return "album";
    if (section.includes("artist")) return "artist";
    if (section.includes("playlist")) return "playlist";
    if (section.includes("podcast")) return "podcast";
    if (section.includes("song") || section.includes("video")) return "song";
    const h = String(href || "").toLowerCase();
    if (h.includes("playlist?list=")) return "playlist";
    if (h.includes("/watch?v=")) return "song";
    if (h.includes("/browse/")) {
        if (h.includes("channel") || h.includes("/uc")) return "artist";
        return "album";
    }
    return "song";
}

function parseResponsiveListItem(renderer, out, seen, sectionTitle) {
    const nav =
        renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.navigationEndpoint
        || renderer.navigationEndpoint
        || renderer.menu?.menuRenderer?.items?.[0]?.menuNavigationItemRenderer?.navigationEndpoint;

    let href = hrefForNavigation(nav);
    const directVideoId = nav?.watchEndpoint?.videoId;
    if (directVideoId) {
        href = YT_WATCH + directVideoId;
    }
    if (!href || seen.has(href)) return;

    let title = "";
    let subtitle = "";
    const cols = renderer.flexColumns || [];
    if (cols.length > 0) {
        title = textFromRuns(cols[0].musicResponsiveListItemFlexColumnRenderer?.text);
    }
    if (cols.length > 1) {
        subtitle = textFromRuns(cols[1].musicResponsiveListItemFlexColumnRenderer?.text);
    }
    if (!title) title = textFromRuns(renderer.headline);

    const thumbs =
        renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || renderer.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails
        || [];

    const type = inferMusicType(href, sectionTitle);
    seen.add(href);
    out.push({
        title: title || "Unknown",
        subtitle: subtitle || "",
        image: bestThumbnail(thumbs),
        href,
        type,
        section: sectionTitle || ""
    });
}

function parseTwoRowItem(renderer, out, seen, sectionTitle) {
    const nav = renderer.navigationEndpoint;
    let href = hrefForNavigation(nav);
    const directVideoId = nav?.watchEndpoint?.videoId;
    if (directVideoId) {
        href = YT_WATCH + directVideoId;
    }
    if (!href || seen.has(href)) return;

    const title = textFromRuns(renderer.title) || textFromRuns(renderer.headline);
    const subtitle = textFromRuns(renderer.subtitle) || textFromRuns(renderer.secondarySubtitle);
    const thumbs =
        renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || [];

    const type = inferMusicType(href, sectionTitle);
    seen.add(href);
    out.push({
        title: title || "Unknown",
        subtitle: subtitle || "",
        image: bestThumbnail(thumbs),
        href,
        type,
        section: sectionTitle || ""
    });
}

function collectShelfContents(shelf, out, seen) {
    const sectionTitle = textFromRuns(shelf.title) || "Results";
    const contents = shelf.contents || [];
    for (const entry of contents) {
        if (entry.musicResponsiveListItemRenderer) {
            parseResponsiveListItem(entry.musicResponsiveListItemRenderer, out, seen, sectionTitle);
        }
        if (entry.musicTwoRowItemRenderer) {
            parseTwoRowItem(entry.musicTwoRowItemRenderer, out, seen, sectionTitle);
        }
    }
}

function walkCollectSearch(node, out, seen) {
    if (!node || typeof node !== "object") return;
    if (node.musicShelfRenderer) {
        collectShelfContents(node.musicShelfRenderer, out, seen);
    }
    if (node.musicCardShelfRenderer && node.musicCardShelfRenderer.contents) {
        const sectionTitle = textFromRuns(node.musicCardShelfRenderer.header?.musicCardShelfHeaderBasicRenderer?.title)
            || textFromRuns(node.musicCardShelfRenderer.title)
            || "Featured";
        for (const entry of node.musicCardShelfRenderer.contents) {
            if (entry.musicResponsiveListItemRenderer) {
                parseResponsiveListItem(entry.musicResponsiveListItemRenderer, out, seen, sectionTitle);
            }
            if (entry.musicTwoRowItemRenderer) {
                parseTwoRowItem(entry.musicTwoRowItemRenderer, out, seen, sectionTitle);
            }
        }
    }
    if (node.musicResponsiveListItemRenderer) {
        parseResponsiveListItem(node.musicResponsiveListItemRenderer, out, seen, "");
    }
    if (node.musicTwoRowItemRenderer) {
        parseTwoRowItem(node.musicTwoRowItemRenderer, out, seen, "");
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
            query
        });

        const results = [];
        const seen = new Set();
        walkCollectSearch(data, results, seen);

        return JSON.stringify(results.slice(0, 60));
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

function resolveFormatUrl(format) {
    if (!format) return null;
    if (format.url) return format.url;
    const cipher = format.signatureCipher || format.cipher;
    if (typeof cipher === "string") {
        const match = cipher.match(/url=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
    }
    return null;
}

function pickBestAudioFormat(formats) {
    if (!formats || !formats.length) return null;
    const audio = [];
    for (const f of formats) {
        const mime = (f.mimeType || "").toLowerCase();
        const streamUrl = resolveFormatUrl(f);
        if (!streamUrl) continue;
        if (mime.startsWith("audio/") || f.audioQuality || parseInt(f.itag, 10) === 140) {
            audio.push({ format: f, streamUrl });
        }
    }
    if (!audio.length) return null;
    audio.sort((a, b) => {
        const pref = (x) => {
            const itag = parseInt(x.format.itag, 10);
            if (itag === 251) return 1000; // opus high
            if (itag === 140) return 900;  // m4a aac
            return parseInt(x.format.bitrate, 10) || 0;
        };
        return pref(b) - pref(a);
    });
    return audio[0];
}

const STREAM_HEADERS = {
    Referer: "https://www.youtube.com/",
    Origin: "https://www.youtube.com"
};

function streamResultFromUrl(title, streamUrl) {
    return {
        streams: [{
            title,
            streamUrl,
            headers: STREAM_HEADERS
        }]
    };
}

async function resolveVideoIdForPlayback(url) {
    let videoId = extractVideoId(url);
    if (videoId) return videoId;

    const playlistId = extractPlaylistId(url);
    if (playlistId) {
        const browseId = playlistToBrowseId(playlistId);
        const tracks = await fetchTracksFromBrowse(browseId);
        if (tracks.length) return extractVideoId(tracks[0].href);
    }

    const browseId = extractBrowseId(url);
    if (browseId) {
        const tracks = await fetchTracksFromBrowse(browseId);
        if (tracks.length) return extractVideoId(tracks[0].href);
    }
    return null;
}

async function fetchPlayerStream(videoId) {
    const payload = {
        videoId,
        contentCheckOk: true,
        racyCheckOk: true
    };
    let lastReason = "";

    for (const client of PLAYER_CLIENTS) {
        try {
            const data = await ytmPost("player", payload, client.ctx);
            const status = data.playabilityStatus?.status;
            const reason = data.playabilityStatus?.reason || status || "";
            if (reason) lastReason = reason;

            if (status && status !== "OK") {
                console.log(`YTM player ${client.name}: ${status} ${reason}`);
                continue;
            }

            const streaming = data.streamingData;
            if (!streaming) continue;

            if (streaming.hlsManifestUrl) {
                return streamResultFromUrl(`HLS · ${client.name}`, streaming.hlsManifestUrl);
            }

            if (streaming.dashManifestUrl) {
                return streamResultFromUrl(`DASH · ${client.name}`, streaming.dashManifestUrl);
            }

            const formats = [
                ...(streaming.adaptiveFormats || []),
                ...(streaming.formats || [])
            ];
            const picked = pickBestAudioFormat(formats);
            if (picked && picked.streamUrl) {
                const q = picked.format.audioQuality || picked.format.quality || "audio";
                const mime = (picked.format.mimeType || "").split(";")[0];
                return streamResultFromUrl(`${q} · ${mime || "audio"}`, picked.streamUrl);
            }
        } catch (e) {
            console.log(`YTM player ${client.name} error: ` + e);
        }
    }

    return { streams: [], error: lastReason || "No playable stream from YouTube Music." };
}

async function extractStreamUrl(url) {
    try {
        const videoId = await resolveVideoIdForPlayback(url);
        if (!videoId) {
            return JSON.stringify({ streams: [], error: "Could not resolve a video ID for this link." });
        }

        const result = await fetchPlayerStream(videoId);
        return JSON.stringify(result);
    } catch (error) {
        console.log("YTM extractStreamUrl error: " + error);
        return JSON.stringify({ streams: [], error: String(error) });
    }
}
