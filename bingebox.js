// ==========================================
// ⚙️ SORA MODULE — BINGEBOX v2 (NOUVEAUX SERVEURS)
// ==========================================

const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";
const TMDB_PROXY = "https://post-eosin.vercel.app/api/proxy?url=";
const BINGEBOX_API = "https://bingebox.to/api/stream";
const BINGEBOX_REFERER = "https://bingebox.to/";

// 🌟 NOUVELLE LISTE DES SERVEURS (Identifiant API + Nom d'affichage)
const SOURCES = [
    { id: "up_vidrock", label: "Algol" },
    { id: "yoru", label: "Gamma" },
    { id: "aldebaran", label: "Aldebaran" },
    { id: "iso", label: "Procyon" },
    { id: "cineby", label: "Sol" },
    { id: "oneroom", label: "Delta" },
    { id: "killjoy", label: "Sirius" },
    { id: "harbor", label: "Polaris" },
    { id: "chamber", label: "Antares" },
    { id: "omen", label: "Capella" },
    { id: "fade", label: "Rigel" },
    { id: "up_ridomovies", label: "Bellatrix" },
    { id: "up_ee3", label: "Mira" },
    { id: "up_cinehdplus", label: "Castor" },
    { id: "up_movies4f", label: "Pollux" },
    { id: "up_watchanimeworld", label: "Sadr" },
    { id: "up_vidlink", label: "Mintaka" },
    { id: "neon", label: "Nova" }
];

// Priorité des langues pour le sous-titre par défaut
const SUB_PRIORITY = ["fre", "fra", "french", "eng", "english"];

const BINGEBOX_ORIGIN = "https://bingebox.to";
const _bingeboxSession = { warmed: false, cookies: {}, warming: null };

function bingeboxDefaultHeaders(extra) {
    const headers = {
        Referer: BINGEBOX_REFERER,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "application/json, text/plain, */*",
    };
    const cookie = bingeboxCookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (extra) {
        for (const key of Object.keys(extra)) headers[key] = extra[key];
    }
    return headers;
}

function bingeboxCookieHeader() {
    const keys = Object.keys(_bingeboxSession.cookies);
    if (!keys.length) return "";
    return keys.map((k) => `${k}=${_bingeboxSession.cookies[k]}`).join("; ");
}

function mergeBingeboxCookies(cookies) {
    if (!cookies || typeof cookies !== "object") return;
    for (const key of Object.keys(cookies)) {
        _bingeboxSession.cookies[key] = cookies[key];
    }
    if (hasCfClearance()) {
        _bingeboxSession.warmed = true;
        globalThis.__bingeboxCfReady = true;
    }
}

function hasCfClearance() {
    return !!_bingeboxSession.cookies.cf_clearance;
}

function isBlockedResponse(text) {
    if (!text) return true;
    const lower = String(text).toLowerCase();
    return lower.includes("just a moment")
        || lower.includes("cf-browser-verification")
        || lower.includes("challenge-platform");
}

function extractJsonFromWebViewPage(text) {
    if (!text) return "";
    const trimmed = String(text).trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
    try {
        const pre = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (pre && pre[1]) {
            const candidate = pre[1].trim();
            if (candidate.startsWith("{") || candidate.startsWith("[")) return candidate;
        }
        const body = trimmed.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (body && body[1]) {
            const inner = body[1].replace(/<[^>]+>/g, "").trim();
            if (inner.startsWith("{") || inner.startsWith("[")) return inner;
        }
    } catch {}
    return trimmed;
}

async function warmBingeboxSession(force) {
    if (!force && hasCfClearance()) return true;
    if (_bingeboxSession.warming) {
        await _bingeboxSession.warming;
        return hasCfClearance();
    }

    _bingeboxSession.warming = (async function () {
        try {
            if (typeof networkFetch !== "function") return;
            const maxWait = hasCfClearance() ? 10 : 22;
            const result = await networkFetch(BINGEBOX_ORIGIN + "/", {
                timeoutSeconds: maxWait + 14,
                returnHTML: true,
                returnCookies: true,
                maxWaitTime: maxWait,
                completeWhenCloudflareReady: true,
                headers: bingeboxDefaultHeaders(),
            });
            mergeBingeboxCookies(result.cookies);
            const html = result.html || "";
            if (hasCfClearance() && !isBlockedResponse(html)) {
                _bingeboxSession.warmed = true;
                globalThis.__bingeboxCfReady = true;
                console.log("[Bingebox] ✅ Cloudflare session ready");
            } else {
                _bingeboxSession.warmed = false;
                globalThis.__bingeboxCfReady = false;
                console.log("[Bingebox] ⚠️ Cloudflare session not ready");
            }
        } catch (e) {
            _bingeboxSession.warmed = false;
            globalThis.__bingeboxCfReady = false;
            console.log("[Bingebox] warm session:", e.message || e);
        } finally {
            _bingeboxSession.warming = null;
        }
    })();

    await _bingeboxSession.warming;
    return hasCfClearance();
}

async function bingeboxTryNativeFetch(url, headers) {
    try {
        if (typeof fetchv2 === "undefined") return null;
        const res = await fetchv2(url, headers, "GET", null);
        const text = await res.text();
        if (text && !isBlockedResponse(text)) return text;
    } catch (e) {
        console.log("[Bingebox] native fetch:", e.message || e);
    }
    return null;
}

async function bingeboxFetchViaWebView(url, headers) {
    const result = await networkFetch(url, {
        timeoutSeconds: 20,
        returnHTML: true,
        returnCookies: true,
        maxWaitTime: 12,
        headers: headers,
    });
    mergeBingeboxCookies(result.cookies);
    return extractJsonFromWebViewPage(result.html || "");
}

async function bingeboxFetch(url, options) {
    options = options || {};
    const nativeOnly = options.nativeOnly === true;

    if (!hasCfClearance()) {
        await warmBingeboxSession(false);
    }

    const headers = bingeboxDefaultHeaders(options.headers || {});
    let text = await bingeboxTryNativeFetch(url, headers);
    if (!text && !nativeOnly) {
        text = await bingeboxFetchViaWebView(url, headers);
    }
    if (!text || isBlockedResponse(text)) return null;

    return {
        ok: true,
        status: 200,
        text: async function () { return text; },
        json: async function () { return JSON.parse(text); },
    };
}

function applyStreamPayload(json, sourceLabel, streams, allSubtitles, seenUrls, seenSubUrls) {
    if (!json.success || !json.data) return false;

    let added = false;
    if (json.data.qualities && Object.keys(json.data.qualities).length > 0) {
        const sortedQualities = Object.keys(json.data.qualities).sort((a, b) => parseInt(b) - parseInt(a));
        for (const quality of sortedQualities) {
            const qUrl = json.data.qualities[quality].url;
            if (qUrl && !seenUrls.has(qUrl)) {
                seenUrls.add(qUrl);
                streams.push({
                    title: `Bingebox ${sourceLabel} (${quality}p)`,
                    streamUrl: qUrl,
                    headers: { Referer: BINGEBOX_REFERER }
                });
                added = true;
            }
        }
    } else {
        const videoUrl = json.data.playlist || json.data.url;
        if (videoUrl && !seenUrls.has(videoUrl)) {
            seenUrls.add(videoUrl);
            const isHLS = videoUrl.includes(".m3u8") || json.data.type === "hls";
            streams.push({
                title: `Bingebox ${sourceLabel} (${isHLS ? "Auto" : "Direct"})`,
                streamUrl: videoUrl,
                headers: { Referer: BINGEBOX_REFERER }
            });
            added = true;
        }
    }

    if (Array.isArray(json.data.captions)) {
        for (const cap of json.data.captions) {
            if (!cap.url || seenSubUrls.has(cap.url)) continue;
            seenSubUrls.add(cap.url);
            const subReferer = (cap.url.match(/https?:\/\/[^/]+/) || [BINGEBOX_REFERER])[0] + "/";
            allSubtitles.push({
                url: cap.url,
                label: cap.label || cap.language || "SUB",
                language: cap.language || "",
                kind: cap.type === "srt" ? "subtitles" : "captions",
                headers: { Referer: subReferer }
            });
        }
    }
    return added;
}

// Browse category keywords (Shirox Movies home)
const keywordGroups = {
    trending: ["!trending", "!hot", "!tr", "!!"],
    topRatedMovie: ["!top-rated-movie", "!topmovie", "!tm", "??"],
    topRatedTV: ["!top-rated-tv", "!toptv", "!tt", "::"],
    popularMovie: ["!popular-movie", "!popmovie", "!pm", ";;"],
    popularTV: ["!popular-tv", "!poptv", "!pt", "++"],
};

function matchesKeyword(keyword, commands) {
    const lower = String(keyword || "").toLowerCase();
    return commands.some((cmd) => lower.startsWith(cmd.toLowerCase()));
}

function bingeboxItemFromTmdb(item) {
    const mediaType = item.media_type || (item.title ? "movie" : "tv");
    if (mediaType !== "movie" && mediaType !== "tv") return null;

    const title = item.title || item.name || "Untitled";
    const year = (item.release_date || item.first_air_date || "").split("-")[0];
    const image = item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : "";

    return {
        title: year ? `${title} (${year})` : title,
        image,
        href: `bingebox://${mediaType}/${item.id}?title=${encodeURIComponent(title)}&year=${year}`,
    };
}

async function fetchTmdbJson(path, page) {
    const tmdbUrl = `https://api.themoviedb.org/3/${path}?api_key=${TMDB_API_KEY}&include_adult=false&language=en-US&page=${page || 1}`;
    const proxyUrl = `${TMDB_PROXY}${encodeURIComponent(tmdbUrl)}&simple=true`;

    for (const url of [tmdbUrl, proxyUrl]) {
        const res = await soraFetch(url);
        if (!res) continue;
        try {
            const data = JSON.parse(await res.text());
            if (data && (data.results || data.id)) return data;
        } catch {
            continue;
        }
    }
    return null;
}

async function fetchBrowseResults(keyword) {
    let path = null;
    if (matchesKeyword(keyword, keywordGroups.trending)) {
        path = "trending/all/week";
    } else if (matchesKeyword(keyword, keywordGroups.topRatedMovie)) {
        path = "movie/top_rated";
    } else if (matchesKeyword(keyword, keywordGroups.topRatedTV)) {
        path = "tv/top_rated";
    } else if (matchesKeyword(keyword, keywordGroups.popularMovie)) {
        path = "movie/popular";
    } else if (matchesKeyword(keyword, keywordGroups.popularTV)) {
        path = "tv/popular";
    }
    if (!path) return null;

    const pages = await Promise.all([1, 2, 3].map((p) => fetchTmdbJson(path, p)));
    const items = pages.flatMap((p) => (p && p.results) || []);
    const results = [];
    const seen = new Set();
    for (const item of items) {
        const mapped = bingeboxItemFromTmdb(item);
        if (mapped && !seen.has(mapped.href)) {
            seen.add(mapped.href);
            results.push(mapped);
        }
    }
    return results;
}


function parseQuery(queryString) {
    const params = {};
    const pairs = queryString.split('&');
    for (let pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const key = decodeURIComponent(pair.slice(0, idx));
        const val = decodeURIComponent(pair.slice(idx + 1));
        params[key] = val;
    }
    return params;
}

// Sélection du meilleur sous-titre selon priorité de langue
function selectBestSubtitle(allSubtitles) {
    for (let lang of SUB_PRIORITY) {
        const found = allSubtitles.find(s =>
            (s.label || "").toLowerCase().includes(lang) ||
            (s.language || "").toLowerCase().includes(lang)
        );
        if (found) return found.url;
    }
    return allSubtitles.length > 0 ? allSubtitles[0].url : "";
}

// ==========================================
// ⚙️ CORE LOGIC
// ==========================================

// 1. RECHERCHE (Via TMDB)
async function searchResults(keyword) {
    console.log(`[Bingebox] 🔍 Recherche de : "${keyword}"`);
    try {
        const browse = await fetchBrowseResults(keyword);
        if (browse) {
            console.log(`[Bingebox] ✅ ${browse.length} résultats browse.`);
            return JSON.stringify(browse);
        }

        const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&page=1&include_adult=false&language=en-US`;
        const proxyUrl = `${TMDB_PROXY}${encodeURIComponent(url)}&simple=true`;
        let data = null;
        for (const fetchUrl of [url, proxyUrl]) {
            const res = await soraFetch(fetchUrl);
            if (!res) continue;
            try {
                data = JSON.parse(await res.text());
                if (data && data.results) break;
            } catch {
                continue;
            }
        }
        if (!data) return JSON.stringify([]);
        const results = [];

        for (let item of (data.results || [])) {
            const mapped = bingeboxItemFromTmdb(item);
            if (mapped) results.push(mapped);
        }

        console.log(`[Bingebox] ✅ ${results.length} résultats trouvés.`);
        return JSON.stringify(results);
    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Recherche: ${e.message}`);
        return JSON.stringify([]);
    }
}

// 2. DÉTAILS (Via TMDB)
async function extractDetails(url) {
    console.log(`[Bingebox] 📖 Chargement détails : ${url}`);
    try {
        const match = url.match(/bingebox:\/\/([^/]+)\/([^?]+)/);
        if (!match) throw new Error("URL invalide");

        const [, type, id] = match;
        const data = await fetchTmdbJson(`${type}/${id}`, 1);
        if (!data) throw new Error("Échec réseau TMDB");

        return JSON.stringify([{
            description: data.overview || "No description available.",
            aliases: `Rating: ${data.vote_average ? data.vote_average.toFixed(1) + '/10' : 'N/A'}`,
            airdate: `Released: ${data.release_date || data.first_air_date || 'Unknown'}`
        }]);
    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Détails: ${e.message}`);
        return JSON.stringify([{ description: "Erreur lors du chargement des détails." }]);
    }
}

// 3. ÉPISODES / FILM
async function extractEpisodes(url) {
    console.log(`[Bingebox] 📂 Chargement épisodes : ${url}`);
    try {
        const match = url.match(/bingebox:\/\/([^/]+)\/([^?]+)\?(.+)/);
        if (!match) throw new Error("URL invalide");

        const type = match[1];
        const id   = match[2];
        const params = parseQuery(match[3]);
        const title = params['title'] || "";
        const year  = params['year']  || "";

        // CAS A : Film
        if (type === 'movie') {
            return JSON.stringify([{
                href: `bingebox-play://movie/${id}?title=${encodeURIComponent(title)}&year=${year}`,
                title: "Full Movie",
                number: 1,
                season: 1
            }]);
        }

        // CAS B : Série — load one season only (fast). Full series list is not needed to play.
        const targetSeason = Math.max(1, parseInt(params['season'] || '1', 10) || 1);
        const sData = await fetchTmdbJson(`tv/${id}/season/${targetSeason}`, 1);
        if (!sData) throw new Error("Échec réseau TMDB");

        let episodes = [];
        for (let ep of (sData.episodes || [])) {
            episodes.push({
                href: `bingebox-play://tv/${id}?title=${encodeURIComponent(title)}&year=${year}&s=${targetSeason}&e=${ep.episode_number}`,
                title: ep.name || `Episode ${ep.episode_number}`,
                number: ep.episode_number,
                season: targetSeason,
                image: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : ''
            });
        }

        console.log(`[Bingebox] ✅ ${episodes.length} épisodes chargés (saison ${targetSeason}).`);
        return JSON.stringify(episodes);

    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Épisodes: ${e.message}`);
        return JSON.stringify([]);
    }
}

// 4. LECTEUR VIDÉO
async function extractStreamUrl(url) {
    console.log(`[Bingebox] 🎬 Extraction vidéo : ${url}`);
    try {
        await warmBingeboxSession(false);

        const match = url.match(/bingebox-play:\/\/([^/]+)\/([^?]+)\?(.+)/);
        if (!match) throw new Error("URL Play invalide");

        const type   = match[1];
        const id     = match[2];
        const params = parseQuery(match[3]);
        const title  = params["title"] || "";
        const year   = params["year"]  || "";
        const s      = params["s"];
        const e      = params["e"];

        const apiMediaType = type === "tv" ? "show" : "movie";
        const headers = bingeboxDefaultHeaders();

        let streams = [];
        let allSubtitles = [];
        const seenUrls = new Set();
        const seenSubUrls = new Set();

        function buildApiUrl(sourceId) {
            let apiUrl = `${BINGEBOX_API}?tmdbId=${id}&mediaType=${apiMediaType}&title=${encodeURIComponent(title)}&year=${year}&source=${sourceId}`;
            if (type === "tv" && s && e) apiUrl += `&season=${s}&episode=${e}`;
            return apiUrl;
        }

        async function trySource(source, nativeOnly) {
            if (streams.length > 0) return false;
            const sourceLabel = source.label.toUpperCase();
            const apiUrl = buildApiUrl(source.id);
            try {
                const res = await bingeboxFetch(apiUrl, { headers: headers, nativeOnly: nativeOnly });
                if (!res) return false;
                const text = await res.text();
                if (!text || isBlockedResponse(text)) return false;
                let json;
                try { json = JSON.parse(text); } catch { return false; }
                return applyStreamPayload(json, sourceLabel, streams, allSubtitles, seenUrls, seenSubUrls);
            } catch {
                return false;
            }
        }

        const deadline = Date.now() + 70000;
        const topSources = SOURCES.slice(0, 6);

        console.log(`[Bingebox] 📡 Probing ${topSources.length} sources in parallel...`);
        await Promise.all(topSources.map(async (source) => {
            if (Date.now() > deadline || streams.length > 0) return;
            await trySource(source, true);
        }));

        if (streams.length === 0 && Date.now() < deadline) {
            if (!hasCfClearance()) {
                console.log("[Bingebox] 🔁 Warming Cloudflare...");
                await warmBingeboxSession(true);
            }
            for (const source of topSources) {
                if (Date.now() > deadline || streams.length > 0) break;
                await trySource(source, false);
            }
        }

        if (streams.length === 0 && Date.now() < deadline) {
            for (const source of SOURCES.slice(6, 12)) {
                if (Date.now() > deadline || streams.length > 0) break;
                await trySource(source, true);
            }
        }

        console.log(`[Bingebox] 📊 ${streams.length} streams | ${allSubtitles.length} sous-titres`);

        if (streams.length === 0) {
            const cfReady = hasCfClearance();
            return JSON.stringify({
                type: "none",
                error: cfReady
                    ? "Bingebox API returned no streams for this episode. Try LordFlix or retry later."
                    : "Bingebox is blocked by Cloudflare. Wait a moment and tap Retry.",
            });
        }

        // Trier les sous-titres
        allSubtitles.sort((a, b) => {
            const getPrio = (s) => {
                const lang = (s.label || s.language || "").toLowerCase();
                for (let i = 0; i < SUB_PRIORITY.length; i++) {
                    if (lang.includes(SUB_PRIORITY[i])) return i;
                }
                return 99;
            };
            return getPrio(a) - getPrio(b);
        });

        return JSON.stringify({
            type: "servers",
            streams,
            subtitles: selectBestSubtitle(allSubtitles),
            subtitlesHeaders: allSubtitles.length > 0
                ? allSubtitles.find(s => s.url === selectBestSubtitle(allSubtitles))?.headers || {}
                : {},
            allSubtitles
        });

    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Stream: ${e.message}`);
        return JSON.stringify({ type: "none", error: e.message || "Stream extraction failed." });
    }
}

// ==========================================
// 🛠️ OUTIL RÉSEAU
// ==========================================
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        if (String(url).includes("bingebox.to")) {
            const bingebox = await bingeboxFetch(url, options);
            if (bingebox) return bingebox;
        }
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
        }
        return await fetch(url, options);
    } catch (e) {
        try { return await fetch(url, options); } catch { return null; }
    }
}

(function (g) {
    if (!g) return;
    g.mergeBingeboxCookies = mergeBingeboxCookies;
    g.warmBingeboxSession = warmBingeboxSession;
})(typeof globalThis !== "undefined" ? globalThis : this);