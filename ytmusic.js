/**
 * YouTube Music module for Shirox / NEPAX
 * Uses the public InnerTube API (same backend as https://music.youtube.com/)
 */

const YTM_HOST = "https://music.youtube.com";
const YTM_API = YTM_HOST + "/youtubei/v1";
const YT_HOST = "https://www.youtube.com";
const YT_API = YT_HOST + "/youtubei/v1";
const YT_WATCH = "https://music.youtube.com/watch?v=";
/** InnerTube filter: songs only */
const YTM_SONG_SEARCH_PARAMS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
const YTM_API_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const YT_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

let cachedVisitorId = null;
let cachedVisitorData = null;

function visitorId() {
    if (!cachedVisitorId) {
        const hex = "0123456789abcdef";
        cachedVisitorId = Array.from({ length: 16 }, () => hex[Math.floor(Math.random() * 16)]).join("");
    }
    return cachedVisitorId;
}

async function ensureVisitorData() {
    if (cachedVisitorData) return cachedVisitorData;
    const pages = [YTM_HOST, YT_HOST];
    const patterns = [
        /"VISITOR_DATA":"([^"]+)"/,
        /"visitorData":"([^"]+)"/,
        /VISITOR_DATA\\":\\"([^\\"]+)\\"/
    ];
    for (const pageUrl of pages) {
        try {
            const html = await (await soraFetch(pageUrl)).text();
            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    cachedVisitorData = match[1];
                    return cachedVisitorData;
                }
            }
        } catch (e) {
            console.log("YTM visitorData fetch failed: " + e);
        }
    }
    return null;
}

function attachVisitorData(context) {
    if (cachedVisitorData && context.client && !context.client.visitorData) {
        context.client.visitorData = cachedVisitorData;
    }
    return context;
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

function buildPlayerAttempts(videoId) {
    return [
        {
            name: "YT_TV",
            host: YT_HOST,
            apiKey: YT_API_KEY,
            context: {
                client: {
                    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
                    clientVersion: "2.0",
                    hl: "en",
                    gl: "US"
                },
                thirdParty: { embedUrl: `${YT_HOST}/watch?v=${videoId}` },
                user: {}
            }
        },
        {
            name: "YT_ANDROID",
            host: YT_HOST,
            apiKey: YT_API_KEY,
            context: {
                client: {
                    clientName: "ANDROID",
                    clientVersion: "20.03.38",
                    androidSdkVersion: 30,
                    hl: "en",
                    gl: "US",
                    userAgent: "com.google.android.youtube/20.03.38 (Linux; U; Android 11) gzip"
                },
                user: {}
            }
        },
        {
            name: "YT_IOS",
            host: YT_HOST,
            apiKey: YT_API_KEY,
            context: {
                client: {
                    clientName: "IOS",
                    clientVersion: "20.03.3",
                    deviceModel: "iPhone14,3",
                    hl: "en",
                    gl: "US",
                    userAgent: "com.google.ios.youtube/20.03.3 (iPhone14,3; U; CPU iOS 16_0 like Mac OS X)"
                },
                user: {}
            }
        },
        {
            name: "YT_MWEB",
            host: YT_HOST,
            apiKey: YT_API_KEY,
            context: {
                client: {
                    clientName: "MWEB",
                    clientVersion: "2.20240401.00.00",
                    hl: "en",
                    gl: "US"
                },
                user: {}
            }
        },
        {
            name: "YTM_TV",
            host: YTM_HOST,
            apiKey: YTM_API_KEY,
            context: ytmContextTV()
        },
        {
            name: "YTM_ANDROID",
            host: YTM_HOST,
            apiKey: YTM_API_KEY,
            context: ytmContextAndroid()
        },
        {
            name: "YTM_ANDROID_MUSIC",
            host: YTM_HOST,
            apiKey: YTM_API_KEY,
            context: ytmContextAndroidMusic()
        },
        {
            name: "YTM_IOS",
            host: YTM_HOST,
            apiKey: YTM_API_KEY,
            context: ytmContextIOS()
        },
        {
            name: "YTM_WEB",
            host: YTM_HOST,
            apiKey: YTM_API_KEY,
            context: ytmContextWeb()
        }
    ];
}

async function innertubePost(host, endpoint, payload, context, apiKey) {
    const apiBase = host + "/youtubei/v1";
    const body = { context: attachVisitorData(context), ...payload };
    const origin = host;
    const response = await soraFetch(`${apiBase}/${endpoint}?key=${apiKey}&prettyPrint=false`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Origin": origin,
            "Referer": origin + "/",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-Visitor-Id": visitorId()
        },
        body: JSON.stringify(body)
    });
    return await response.json();
}

async function ytmPost(endpoint, payload, contextFactory) {
    const ctx = attachVisitorData((contextFactory || ytmContextWeb)());
    return innertubePost(YTM_HOST, endpoint, payload, ctx, YTM_API_KEY);
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
    const videoId = directVideoId || extractVideoId(href);
    seen.add(href);
    out.push({
        title: title || "Unknown",
        subtitle: subtitle || "",
        image: bestThumbnail(thumbs),
        href: videoId ? YT_WATCH + videoId : href,
        type,
        videoId: videoId || "",
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
    const videoId = directVideoId || extractVideoId(href);
    seen.add(href);
    out.push({
        title: title || "Unknown",
        subtitle: subtitle || "",
        image: bestThumbnail(thumbs),
        href: videoId ? YT_WATCH + videoId : href,
        type,
        videoId: videoId || "",
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

function normalizeSongEntry(raw) {
    const videoId = raw.videoId || extractVideoId(raw.href);
    if (!videoId) return null;
    return {
        title: raw.title || "Unknown",
        subtitle: raw.subtitle || "",
        image: raw.image || "",
        href: YT_WATCH + videoId,
        type: "song",
        videoId,
        section: raw.section || "Songs"
    };
}

function collectSearchRaw(data, out, seen) {
    walkCollectSearch(data, out, seen);
    for (const item of out) {
        const navId = item.videoId;
        if (navId) item.href = YT_WATCH + navId;
    }
}

const SKIP_HOME_SECTION = /settings|store|subscription|upgrade|learn more|get premium/i;
const MAX_HOME_SECTIONS = 6;
const MAX_HOME_ITEMS_PER_SECTION = 10;

function shelfSectionTitle(shelf) {
    return (
        textFromRuns(shelf.title)
        || textFromRuns(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title)
        || textFromRuns(shelf.header?.musicShelfHeaderRenderer?.title)
        || textFromRuns(shelf.header?.musicCardShelfHeaderBasicRenderer?.title)
        || ""
    ).trim();
}

function pushHomeShelfSection(shelf, sections, seenIds) {
    const title = shelfSectionTitle(shelf);
    if (!title || SKIP_HOME_SECTION.test(title)) return;

    const raw = [];
    const seen = new Set();
    if (shelf.contents && Array.isArray(shelf.contents)) {
        collectShelfContents({ contents: shelf.contents, title }, raw, seen);
    } else {
        walkCollectSearch(shelf, raw, seen);
    }

    const songs = [];
    for (const item of raw) {
        const song = normalizeSongEntry(item);
        if (!song || seenIds.has(song.videoId)) continue;
        seenIds.add(song.videoId);
        songs.push(song);
    }
    if (songs.length < 2) return;

    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48) || "section";
    sections.push({
        id,
        title,
        items: songs.slice(0, MAX_HOME_ITEMS_PER_SECTION)
    });
}

function walkHomeBrowse(node, sections, seenIds) {
    if (!node || typeof node !== "object") return;
    if (node.musicCarouselShelfRenderer) {
        pushHomeShelfSection(node.musicCarouselShelfRenderer, sections, seenIds);
    }
    if (node.musicShelfRenderer) {
        pushHomeShelfSection(node.musicShelfRenderer, sections, seenIds);
    }
    if (node.musicCardShelfRenderer) {
        pushHomeShelfSection(node.musicCardShelfRenderer, sections, seenIds);
    }
    if (Array.isArray(node)) {
        for (const item of node) walkHomeBrowse(item, sections, seenIds);
        return;
    }
    for (const key of Object.keys(node)) {
        walkHomeBrowse(node[key], sections, seenIds);
    }
}

/** Fast home feed: YTM browse (home + charts) — one call from Swift, ~2 API requests. */
async function homeRecommendations() {
    try {
        await ensureVisitorData();
        const sections = [];
        const seenIds = new Set();

        const [homeData, chartsData] = await Promise.all([
            ytmPost("browse", { browseId: "FEmusic_home" }).catch((e) => {
                console.log("YTM home browse: " + e);
                return null;
            }),
            ytmPost("browse", { browseId: "FEmusic_charts" }).catch((e) => {
                console.log("YTM charts browse: " + e);
                return null;
            })
        ]);

        if (homeData) walkHomeBrowse(homeData, sections, seenIds);
        if (chartsData) walkHomeBrowse(chartsData, sections, seenIds);

        if (sections.length === 0) {
            const songData = await ytmPost("search", {
                query: "top songs",
                params: YTM_SONG_SEARCH_PARAMS
            });
            const raw = [];
            walkCollectSearch(songData, raw, new Set());
            const items = [];
            for (const r of raw) {
                const song = normalizeSongEntry(r);
                if (song && !seenIds.has(song.videoId)) {
                    seenIds.add(song.videoId);
                    items.push(song);
                }
                if (items.length >= MAX_HOME_ITEMS_PER_SECTION) break;
            }
            if (items.length) {
                sections.push({ id: "trending", title: "Trending", items });
            }
        }

        return JSON.stringify({ sections: sections.slice(0, MAX_HOME_SECTIONS) });
    } catch (error) {
        console.log("YTM homeRecommendations error: " + error);
        return JSON.stringify({ sections: [] });
    }
}

async function searchResults(keyword) {
    try {
        const query = String(keyword || "").trim();
        if (!query) return JSON.stringify([]);

        const final = [];
        const seenIds = new Set();
        const seenHref = new Set();

        function pushSong(raw) {
            const song = normalizeSongEntry(raw);
            if (!song || seenIds.has(song.videoId)) return;
            seenIds.add(song.videoId);
            seenHref.add(song.href);
            final.push(song);
        }

        function pushOther(raw) {
            const href = raw.href || "";
            if (!href || seenHref.has(href)) return;
            const id = extractVideoId(href);
            if (id && seenIds.has(id)) return;
            seenHref.add(href);
            final.push({
                title: raw.title || "Unknown",
                subtitle: raw.subtitle || "",
                image: raw.image || "",
                href,
                type: raw.type || inferMusicType(href, raw.section),
                videoId: id || "",
                section: raw.section || ""
            });
        }

        // 1) Songs from YouTube Music (best for play + download)
        try {
            const songData = await ytmPost("search", {
                query,
                params: YTM_SONG_SEARCH_PARAMS
            });
            const songRaw = [];
            const seen = new Set();
            walkCollectSearch(songData, songRaw, seen);
            for (const raw of songRaw) {
                pushSong(raw);
            }
        } catch (e) {
            console.log("YTM song search: " + e);
        }

        // 2) Videos section (some tracks appear here)
        try {
            const videoParams = "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D";
            const videoData = await ytmPost("search", { query, params: videoParams });
            const videoRaw = [];
            walkCollectSearch(videoData, videoRaw, new Set());
            for (const raw of videoRaw) {
                pushSong(raw);
            }
        } catch (e) {
            console.log("YTM video search: " + e);
        }

        // 3) General YTM search — albums, artists, playlists (not for direct stream)
        try {
            const allData = await ytmPost("search", { query });
            const allRaw = [];
            walkCollectSearch(allData, allRaw, new Set());
            for (const raw of allRaw) {
                const id = extractVideoId(raw.href);
                if (id) {
                    pushSong(raw);
                } else {
                    pushOther(raw);
                }
            }
        } catch (e) {
            console.log("YTM general search: " + e);
        }

        return JSON.stringify(final.slice(0, 50));
    } catch (error) {
        console.log("YTM searchResults error: " + error);
        return JSON.stringify([]);
    }
}

/** Fast song-only search (playlist import). */
async function searchResultsSongsOnly(keyword) {
    try {
        const query = String(keyword || "").trim();
        if (!query) return JSON.stringify([]);

        const final = [];
        const seenIds = new Set();

        const songData = await ytmPost("search", {
            query,
            params: YTM_SONG_SEARCH_PARAMS
        });
        const songRaw = [];
        walkCollectSearch(songData, songRaw, new Set());
        for (const raw of songRaw) {
            const song = normalizeSongEntry(raw);
            if (!song || seenIds.has(song.videoId)) continue;
            seenIds.add(song.videoId);
            final.push(song);
            if (final.length >= 15) break;
        }
        return JSON.stringify(final);
    } catch (error) {
        console.log("YTM searchResultsSongsOnly error: " + error);
        return JSON.stringify([]);
    }
}

/** Parallel song search for Spotify import — arg: JSON array of query strings. */
async function searchResultsBatch(payloadJson) {
    let queries = [];
    try {
        queries = JSON.parse(String(payloadJson || "[]"));
    } catch (_) {
        return JSON.stringify({});
    }
    if (!Array.isArray(queries)) return JSON.stringify({});

    const unique = [...new Set(
        queries.map((q) => String(q || "").trim()).filter(Boolean)
    )];
    const out = {};
    let cursor = 0;
    const workers = 8;

    async function worker() {
        while (cursor < unique.length) {
            const i = cursor++;
            const q = unique[i];
            try {
                const json = await searchResultsSongsOnly(q);
                out[q] = JSON.parse(json);
            } catch (_) {
                out[q] = [];
            }
        }
    }

    const n = Math.min(workers, unique.length);
    await Promise.all(Array.from({ length: n }, () => worker()));
    return JSON.stringify(out);
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
        const itag = parseInt(f.itag, 10);
        if (mime.startsWith("audio/") || f.audioQuality || itag === 141 || itag === 140 || itag === 139) {
            audio.push({ format: f, streamUrl });
        }
    }
    if (!audio.length) return null;
    audio.sort((a, b) => {
        const pref = (x) => {
            const itag = parseInt(x.format.itag, 10);
            const mime = (x.format.mimeType || "").toLowerCase();
            const br = parseInt(x.format.bitrate, 10) || parseInt(x.format.averageBitrate, 10) || 0;
            let score = br;
            if (itag === 141) score += 600000;
            else if (itag === 140 || mime.includes("mp4") || mime.includes("mpeg")) score += 500000;
            else if (itag === 139) score += 400000;
            else if (itag === 251 || mime.includes("webm") || mime.includes("opus")) score = 200;
            else score += 100000;
            return score;
        };
        return pref(b) - pref(a);
    });
    return audio[0];
}

function collectAllAudioFormats(formats) {
    if (!formats || !formats.length) return [];
    const audio = [];
    for (const f of formats) {
        const mime = (f.mimeType || "").toLowerCase();
        const streamUrl = resolveFormatUrl(f);
        if (!streamUrl) continue;
        const itag = parseInt(f.itag, 10);
        if (mime.startsWith("audio/") || f.audioQuality || itag === 141 || itag === 140 || itag === 139 || itag === 599) {
            audio.push({ format: f, streamUrl });
        }
    }
    audio.sort((a, b) => {
        const pref = (x) => {
            const itag = parseInt(x.format.itag, 10);
            const mime = (x.format.mimeType || "").toLowerCase();
            const br = parseInt(x.format.bitrate, 10) || parseInt(x.format.averageBitrate, 10) || 0;
            let score = br;
            if (itag === 141) score += 600000;
            else if (itag === 140 || mime.includes("mp4") || mime.includes("mpeg")) score += 500000;
            else if (itag === 139) score += 400000;
            else if (itag === 251 || mime.includes("webm") || mime.includes("opus")) score = 200;
            else score += 100000;
            return score;
        };
        return pref(b) - pref(a);
    });
    return audio;
}

function collectProgressiveFormats(formats) {
    const combined = [];
    for (const f of formats) {
        const streamUrl = resolveFormatUrl(f);
        if (!streamUrl) continue;
        const mime = (f.mimeType || "").toLowerCase();
        const itag = parseInt(f.itag, 10);
        if (mime.includes("video") && !mime.includes("video/webm") && (itag === 18 || itag === 22)) {
            combined.push({ format: f, streamUrl });
        }
    }
    combined.sort((a, b) => (parseInt(a.format.itag, 10) || 99) - (parseInt(b.format.itag, 10) || 99));
    return combined;
}

/** Audio-only first, then progressive MP4 with audio (itag 18/22). */
function pickBestPlayableFormat(formats) {
    const audio = collectAllAudioFormats(formats);
    if (audio.length) return audio[0];
    const combined = collectProgressiveFormats(formats);
    return combined.length ? combined[0] : null;
}

function streamUrlIsProgressiveVideo(url) {
    const u = String(url || "").toLowerCase();
    return u.includes("itag=18") || u.includes("itag=22");
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

async function searchFirstSongVideoId(query) {
    const q = String(query || "").trim();
    if (!q) return null;

    async function scan(data) {
        const results = [];
        const seen = new Set();
        walkCollectSearch(data, results, seen);
        for (const item of results) {
            const id = extractVideoId(item.href);
            if (id) return id;
        }
        return null;
    }

    try {
        let data = await ytmPost("search", { query: q, params: YTM_SONG_SEARCH_PARAMS });
        let id = await scan(data);
        if (id) return id;
        data = await ytmPost("search", { query: q });
        return await scan(data);
    } catch (e) {
        console.log("YTM searchFirstSongVideoId: " + e);
        return null;
    }
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

/** Resolve a playable video: direct link → search by title/artist → album/playlist browse. */
async function resolveVideoIdForPlay(url, title, artist) {
    let videoId = extractVideoId(url);
    if (videoId) return videoId;

    const query = [title, artist]
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();

    if (query) {
        videoId = await searchFirstSongVideoId(query);
        if (videoId) return videoId;
    }

    return resolveVideoIdForPlayback(url);
}

/** Music player: direct progressive audio only (no HLS/DASH — they hang in AVPlayer). */
function streamsDirectAudioOnly(data, clientName) {
    const status = data.playabilityStatus?.status;
    const reason = data.playabilityStatus?.reason || "";
    if (status && status !== "OK") {
        return { error: reason || status };
    }
    const streaming = data.streamingData;
    if (!streaming) return { error: reason || "No streaming data" };

    const formats = [
        ...(streaming.adaptiveFormats || []),
        ...(streaming.formats || [])
    ];
    const audio = collectAllAudioFormats(formats);
    const progressive = collectProgressiveFormats(formats);
    const picked = audio.length ? audio : progressive;
    if (!picked.length) {
        return { error: reason || "No direct audio stream (try another track)" };
    }

    const streams = [];
    const seen = new Set();
    for (const entry of picked) {
        if (!entry.streamUrl || seen.has(entry.streamUrl)) continue;
        seen.add(entry.streamUrl);
        const q = entry.format.audioQuality || entry.format.quality || "Audio";
        const mime = (entry.format.mimeType || "").split(";")[0];
        streams.push({
            title: `${q} · ${mime || "stream"}`,
            streamUrl: entry.streamUrl,
            headers: STREAM_HEADERS
        });
    }
    if (!streams.length) {
        return { error: reason || "No direct audio stream (try another track)" };
    }
    return { streams };
}

function streamsFromPlayerData(data, clientName) {
    return streamsDirectAudioOnly(data, clientName);
}

function parseYtInitialPlayerResponse(html) {
    const key = "ytInitialPlayerResponse";
    const start = html.indexOf(key);
    if (start === -1) return null;
    const braceStart = html.indexOf("{", start);
    if (braceStart === -1) return null;
    let depth = 0;
    for (let i = braceStart; i < html.length && i < braceStart + 2500000; i++) {
        const ch = html[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(html.substring(braceStart, i + 1));
                } catch (e) {
                    return null;
                }
            }
        }
    }
    return null;
}

async function fetchFromWatchPage(videoId, host) {
    const base = host || YT_HOST;
    try {
        const url = `${base}/watch?v=${videoId}`;
        const response = await soraFetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9"
            }
        });
        const html = await response.text();
        const player = parseYtInitialPlayerResponse(html);
        if (!player) return null;
        const label = base.includes("music") ? "YTM_PAGE" : "YT_PAGE";
        const result = streamsDirectAudioOnly(player, label);
        if (result.streams && result.streams.length) return result;
        if (result.error && !isLoginRequired(result.error, "")) return result;
        return null;
    } catch (e) {
        console.log("YTM watch page extract error: " + e);
        return null;
    }
}

function isLoginRequired(reason, status) {
    const text = `${status || ""} ${reason || ""}`.toLowerCase();
    return text.includes("sign in") || text.includes("login") || status === "LOGIN_REQUIRED";
}

async function fetchPlayerStream(videoId) {
    let lastReason = "";

    // 1) Watch page embed data (fastest; no visitor bootstrap required)
    for (const host of [YTM_HOST, YT_HOST]) {
        const pageResult = await fetchFromWatchPage(videoId, host);
        if (pageResult && pageResult.streams && pageResult.streams.length) {
            return pageResult;
        }
        if (pageResult && pageResult.error) lastReason = pageResult.error;
    }

    await ensureVisitorData();

    // 2) InnerTube — ANDROID/IOS/TV first (direct urls without cipher)
    const payload = { videoId, contentCheckOk: true, racyCheckOk: true };
    const priority = [
        "YT_ANDROID", "YT_IOS", "YT_TV", "YT_MWEB",
        "YTM_ANDROID_MUSIC", "YTM_ANDROID", "YTM_IOS", "YTM_WEB", "YTM_TV"
    ];
    const attempts = buildPlayerAttempts(videoId).sort(
        (a, b) => priority.indexOf(a.name) - priority.indexOf(b.name)
    );

    let progressiveFallback = null;

    for (const attempt of attempts) {
        try {
            const data = await innertubePost(attempt.host, "player", payload, attempt.context, attempt.apiKey);
            const status = data.playabilityStatus?.status;
            const reason = data.playabilityStatus?.reason || status || "";
            if (reason) lastReason = reason;
            if (isLoginRequired(reason, status)) continue;
            if (status && status !== "OK") continue;
            const result = streamsDirectAudioOnly(data, attempt.name);
            if (result.streams && result.streams.length) {
                const hasAudioOnly = result.streams.some(
                    (s) => s.streamUrl && !streamUrlIsProgressiveVideo(s.streamUrl)
                );
                if (hasAudioOnly) return result;
                if (!progressiveFallback) progressiveFallback = result;
                continue;
            }
            if (result.error) lastReason = result.error;
        } catch (e) {
            console.log(`YTM player ${attempt.name} error: ` + e);
        }
    }

    if (progressiveFallback) return progressiveFallback;

    return { streams: [], error: lastReason || "No playable stream found." };
}

/**
 * Play any track: search YouTube Music by title if needed, then stream.
 * Args: url, title (optional), artist (optional)
 */
async function extractStreamUrl(url, title, artist) {
    try {
        const safeTitle = title != null ? String(title) : "";
        const safeArtist = artist != null ? String(artist) : "";
        const videoId = await resolveVideoIdForPlay(url, safeTitle, safeArtist);

        if (!videoId) {
            const label = [safeTitle, safeArtist].filter(Boolean).join(" - ") || "this track";
            return JSON.stringify({
                streams: [],
                error: `Could not find "${label}" on YouTube Music.`
            });
        }

        const result = await fetchPlayerStream(videoId);
        if (!result.streams || !result.streams.length) {
            result.error = result.error || "No playable stream found.";
        }
        return JSON.stringify(result);
    } catch (error) {
        console.log("YTM extractStreamUrl error: " + error);
        return JSON.stringify({ streams: [], error: String(error) });
    }
}

// --- Spotify playlist import (public playlists → track list for YTM matching) ---

function extractSpotifyPlaylistId(url) {
    const s = String(url || "").trim();
    if (!s) return null;
    const uri = s.match(/spotify:playlist:([a-zA-Z0-9]+)/i);
    if (uri) return uri[1];
    const web = s.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?playlist\/([a-zA-Z0-9]+)/i);
    if (web) return web[1];
    return null;
}

function extractSpotifyAlbumId(url) {
    const s = String(url || "").trim();
    if (!s) return null;
    const uri = s.match(/spotify:album:([a-zA-Z0-9]+)/i);
    if (uri) return uri[1];
    const web = s.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?album\/([a-zA-Z0-9]+)/i);
    if (web) return web[1];
    return null;
}

function extractSpotifyImport(url) {
    const playlistId = extractSpotifyPlaylistId(url);
    if (playlistId) return { kind: "playlist", id: playlistId };
    const albumId = extractSpotifyAlbumId(url);
    if (albumId) return { kind: "album", id: albumId };
    return null;
}

async function spotifyWebAccessToken() {
    try {
        await soraFetch("https://open.spotify.com/", {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }
        });
    } catch (e) {
        console.log("Spotify warm-up failed: " + e);
    }

    const endpoints = [
        "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
        "https://open.spotify.com/get_access_token?reason=transport&productType=embed"
    ];
    const apiHeaders = {
        "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        Accept: "application/json",
        Referer: "https://open.spotify.com/",
        Origin: "https://open.spotify.com"
    };
    for (const url of endpoints) {
        try {
            const res = await soraFetch(url, { headers: apiHeaders });
            const data = await res.json();
            if (data && (data.accessToken || data.access_token)) {
                return data.accessToken || data.access_token;
            }
        } catch (e) {
            console.log("Spotify token fetch failed: " + e);
        }
    }
    return null;
}

async function spotifyApiGet(path, token) {
    const res = await soraFetch("https://api.spotify.com/v1" + path, {
        headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error("Spotify API " + res.status + (text ? ": " + text.slice(0, 160) : ""));
    }
    return await res.json();
}

/**
 * Returns Spotify playlist metadata + track list (title/artist/image).
 * Shirox resolves each track on YouTube Music when building the local playlist.
 * Arg: Spotify playlist URL or URI.
 */
function spotifyParseEmbedTrackListJSON(html) {
    const marker = '"trackList":';
    const idx = html.indexOf(marker);
    if (idx < 0) return null;
    let i = idx + marker.length;
    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] !== "[") return null;
    let depth = 0;
    const start = i;
    for (; i < html.length; i++) {
        const c = html[i];
        if (c === "[") depth++;
        else if (c === "]") {
            depth--;
            if (depth === 0) {
                try {
                    const items = JSON.parse(html.slice(start, i + 1));
                    if (!Array.isArray(items) || !items.length) return null;
                    const tracks = [];
                    const seen = new Set();
                    for (const item of items) {
                        const title = String(item.title || item.name || "").trim();
                        if (!title) continue;
                        let artist = String(item.subtitle || "")
                            .replace(/\u00a0/g, " ")
                            .trim();
                        if (!artist && Array.isArray(item.artists)) {
                            artist = item.artists
                                .map((a) => (a && a.name) || "")
                                .filter(Boolean)
                                .join(", ");
                        }
                        const key = title + "\0" + artist;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        tracks.push({ title, artist, image: "" });
                    }
                    if (!tracks.length) return null;
                    let playlistName = "Spotify Playlist";
                    const nameMatch = html.match(/"name":"([^"]{1,120})"/);
                    if (nameMatch && nameMatch[1] && nameMatch[1] !== "Spotify") {
                        playlistName = nameMatch[1];
                    }
                    let playlistImage = "";
                    const imgMatch = html.match(/(https:\/\/i\.scdn\.co\/image\/[^"]+)"/);
                    if (imgMatch) playlistImage = imgMatch[1];
                    return { playlistName, playlistImage, tracks };
                } catch (_) {
                    return null;
                }
            }
        }
    }
    return null;
}

function spotifyTracksFromEmbedHTML(html, playlistId) {
    const jsonParsed = spotifyParseEmbedTrackListJSON(html);
    if (jsonParsed && jsonParsed.tracks && jsonParsed.tracks.length) {
        return jsonParsed;
    }

    const tracks = [];
    const seen = new Set();
    const patterns = [
        /"uri":"spotify:track:[A-Za-z0-9]{22}"[^}]{0,80}?"title":"([^"]+)"[^}]{0,80}?"subtitle":"([^"]*)"/g,
        /"uri":"spotify:track:[A-Za-z0-9]{22}","uid":"[^"]*","title":"([^"]+)","subtitle":"([^"]*)"/g
    ];
    for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(html)) !== null && tracks.length < 500) {
            const title = (m[1] || "").trim();
            const artist = (m[2] || "").replace(/\u00a0/g, " ").trim();
            if (!title) continue;
            const key = title + "\0" + artist;
            if (seen.has(key)) continue;
            seen.add(key);
            tracks.push({ title, artist, image: "" });
        }
    }
    let playlistName = "Spotify Playlist";
    const nameMatch = html.match(/"name":"([^"]{1,120})"/);
    if (nameMatch && nameMatch[1] && nameMatch[1] !== "Spotify") {
        playlistName = nameMatch[1];
    }
    if (!tracks.length) return null;
    return { playlistName, playlistImage: "", tracks };
}

async function spotifyEmbedTrackList(kind, id) {
    try {
        const res = await soraFetch(
            "https://open.spotify.com/embed/" + kind + "/" + id,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            }
        );
        const html = await res.text();
        return spotifyTracksFromEmbedHTML(html, id);
    } catch (e) {
        console.log("Spotify embed scrape: " + e);
        return null;
    }
}

async function spotifyPlaylistTrackList(playlistUrl) {
    try {
        const parsed = extractSpotifyImport(playlistUrl);
        if (!parsed) {
            return JSON.stringify({
                error: "Paste a valid Spotify playlist or album link (open.spotify.com/playlist/… or …/album/…)."
            });
        }

        const embedData = await spotifyEmbedTrackList(parsed.kind, parsed.id);
        if (embedData && embedData.tracks && embedData.tracks.length) {
            return JSON.stringify({
                playlistName: embedData.playlistName,
                playlistImage: embedData.playlistImage || "",
                tracks: embedData.tracks
            });
        }

        const token = await spotifyWebAccessToken();
        if (!token) {
            return JSON.stringify({
                error: "Could not connect to Spotify. Check your network and try again."
            });
        }

        if (parsed.kind === "album") {
            return JSON.stringify(await spotifyAlbumViaAPI(parsed.id, token));
        }

        return JSON.stringify(await spotifyPlaylistViaAPI(parsed.id, token));
    } catch (e) {
        console.log("spotifyPlaylistTrackList error: " + e);
        return JSON.stringify({ error: String(e.message || e) });
    }
}

async function spotifyPlaylistViaAPI(playlistId, token) {
    let playlistName = "Spotify Playlist";
    let playlistImage = "";
    try {
        const meta = await spotifyApiGet(
            "/playlists/" + playlistId + "?fields=name,images",
            token
        );
        if (meta.name) playlistName = meta.name;
        if (meta.images && meta.images[0] && meta.images[0].url) {
            playlistImage = meta.images[0].url;
        }
    } catch (e) {
        console.log("Spotify playlist meta: " + e);
    }

    const tracks = [];
    let offset = 0;
    const limit = 100;
    const maxTracks = 500;

    while (tracks.length < maxTracks) {
        const page = await spotifyApiGet(
            "/playlists/" +
                playlistId +
                "/tracks?limit=" +
                limit +
                "&offset=" +
                offset +
                "&additional_types=track",
            token
        );
        const items = page.items || [];
        if (!items.length) break;

        for (const row of items) {
            const t = row.track;
            if (!t || t.type !== "track" || t.is_local) continue;
            const artists = (t.artists || [])
                .map((a) => a.name)
                .filter(Boolean)
                .join(", ");
            const image =
                (t.album &&
                    t.album.images &&
                    t.album.images[0] &&
                    t.album.images[0].url) ||
                playlistImage ||
                "";
            tracks.push({
                title: t.name || "Unknown",
                artist: artists,
                image: image
            });
            if (tracks.length >= maxTracks) break;
        }

        if (!page.next) break;
        offset += items.length;
    }

    if (!tracks.length) {
        return {
            error: "No tracks found. The playlist may be private, empty, or unavailable."
        };
    }

    return {
        playlistName: playlistName,
        playlistImage: playlistImage,
        tracks: tracks
    };
}

async function spotifyAlbumViaAPI(albumId, token) {
    let albumName = "Spotify Album";
    let albumImage = "";
    let albumArtists = "";
    try {
        const meta = await spotifyApiGet(
            "/albums/" + albumId + "?market=from_token",
            token
        );
        if (meta.name) albumName = meta.name;
        if (meta.images && meta.images[0] && meta.images[0].url) {
            albumImage = meta.images[0].url;
        }
        albumArtists = (meta.artists || [])
            .map((a) => a.name)
            .filter(Boolean)
            .join(", ");
    } catch (e) {
        console.log("Spotify album meta: " + e);
    }

    const tracks = [];
    let next = "/albums/" + albumId + "/tracks?limit=50&market=from_token";
    const maxTracks = 500;

    while (next && tracks.length < maxTracks) {
        const page = await spotifyApiGet(next, token);
        const items = page.items || [];
        if (!items.length) break;

        for (const t of items) {
            if (!t || t.type !== "track") continue;
            const artists = (t.artists || [])
                .map((a) => a.name)
                .filter(Boolean)
                .join(", ");
            tracks.push({
                title: t.name || "Unknown",
                artist: artists || albumArtists,
                image: albumImage
            });
            if (tracks.length >= maxTracks) break;
        }

        if (!page.next) break;
        try {
            const u = new URL(page.next);
            next = u.pathname + u.search;
        } catch (e) {
            break;
        }
    }

    if (!tracks.length) {
        return {
            error: "No tracks found. The album may be private, empty, or unavailable."
        };
    }

    return {
        playlistName: albumName,
        playlistImage: albumImage,
        tracks: tracks
    };
}
