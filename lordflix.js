// LordFlix — TMDB browse + lordflix.club streams (NEPAX/Shirox build)
// v1.2.0 — Phoenix fast-path, server race, TMDB metadata cache, parallel seasons

const TMDB_KEY = "9801b6b0548ad57581d111ea690c85c8";
const TMDB_PROXY = "https://post-eosin.vercel.app/api/proxy?url=";
const FAST_SERVER = "Phoenix";
const LORDFLIX_MOVIE_FALLBACK = ["Berlin", "Oslo", "Luna", "Rio", "Ativa", "Moscow"];
const LORDFLIX_SERIES_FALLBACK = ["Berlin", "Oslo", "Luna", "Sakura", "Rio", "Ativa", "Moscow"];
const _metaCache = {};
const _showCache = {};
const _episodeCache = {};
const _streamCache = {};
const STREAM_CACHE_MS = 15 * 60 * 1000;
const LORDFLIX_HEADERS = {
    Origin: "https://lordflix.org",
    Referer: "https://lordflix.org/",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
};

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

function tmdbProxyUrl(path, page, extraQuery) {
    let url = `https://api.themoviedb.org/3/${path}?api_key=${TMDB_KEY}&include_adult=false`;
    if (page != null) url += `&page=${page}`;
    if (extraQuery) url += "&" + extraQuery;
    return `${TMDB_PROXY}${encodeURIComponent(url)}&simple=true`;
}

function cacheGet(store, key) {
    const entry = store[key];
    if (!entry) return null;
    if (entry.expires && Date.now() > entry.expires) {
        delete store[key];
        return null;
    }
    return entry.value;
}

function cacheSet(store, key, value, ttlMs) {
    store[key] = { value: value, expires: ttlMs ? Date.now() + ttlMs : 0 };
}

async function fetchJson(url, options) {
    const res = await soraFetch(url, options);
    if (!res) throw new Error("Network request failed");
    return res.json();
}

async function fetchText(url, options) {
    const res = await soraFetch(url, options);
    if (!res) throw new Error("Network request failed");
    return res.text();
}

function normalizePath(id) {
    const raw = String(id || "").trim();
    if (!raw) return "";
    return raw.startsWith("/") ? raw : `/${raw}`;
}

function parseMovieId(path) {
    const match = path.match(/\/movie\/([^/?#]+)/i);
    return match ? match[1] : null;
}

function parseTvId(path) {
    const match = path.match(/\/tv\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)/i);
    if (!match) return null;
    return { showId: match[1], season: match[2], episode: match[3] };
}

async function fetchTmdbMovie(movieId, withExternalIds) {
    const extra = withExternalIds ? "append_to_response=external_ids" : null;
    try {
        return await fetchJson(tmdbProxyUrl("movie/" + movieId, null, extra));
    } catch (e) {
        return null;
    }
}

async function fetchTmdbShow(showId, withExternalIds) {
    const cacheKey = "show:" + showId;
    const cached = cacheGet(_showCache, cacheKey);
    if (cached) return cached;
    const extra = withExternalIds ? "append_to_response=external_ids" : null;
    try {
        const data = await fetchJson(tmdbProxyUrl("tv/" + showId, null, extra));
        if (data) cacheSet(_showCache, cacheKey, data, 10 * 60 * 1000);
        return data;
    } catch (e) {
        return null;
    }
}

async function fetchVideasyMovie(movieId) {
    try {
        return await fetchJson(
            `https://db.videasy.net/3/movie/${movieId}?append_to_response=external_ids&language=en`
        );
    } catch (e) {
        return null;
    }
}

async function fetchVideasyShow(showId) {
    try {
        return await fetchJson(
            `https://db.videasy.net/3/tv/${showId}?append_to_response=external_ids&language=en`
        );
    } catch (e) {
        return null;
    }
}

function yearFromDate(value) {
    if (!value) return "";
    const y = new Date(value).getFullYear();
    return Number.isFinite(y) ? String(y) : "";
}

function isFutureDate(value) {
    if (!value) return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) && d > new Date();
}

function encodeQuote(str) {
    return encodeURIComponent(String(str || ""))
        .replace(/%20/g, "+")
        .replace(/\+/g, "%20");
}

function formatServerError(server, err) {
    let msg = err && err.message ? err.message : String(err);
    if (msg.startsWith("Error: ")) msg = msg.slice(7);
    if (msg.startsWith(server + ": ")) return msg;
    return server + ": " + msg;
}

function buildSnowhouseUrl({ title, type, year, imdbId, tmdbId, season, episode, server }) {
    const encTitle = encodeQuote(title);
    const y = year || "";
    const imdb = imdbId || "";
    const tmdb = tmdbId || "";
    let url =
        `https://snowhouse.lordflix.club/?title=${encTitle}&type=${type}` +
        `&year=${y}&imdb=${imdb}&tmdb=${tmdb}&server=${encodeURIComponent(server)}`;
    if (season != null && season !== "" && episode != null && episode !== "") {
        url += `&season=${season}&episode=${episode}`;
    }
    return url;
}

async function fetchStreamMetadata(kind, id) {
    const cacheKey = kind + ":" + id;
    const cached = cacheGet(_metaCache, cacheKey);
    if (cached) return cached;

    const tmdb =
        kind === "movie"
            ? await fetchTmdbMovie(id, true)
            : await fetchTmdbShow(id, true);

    if (tmdb && (tmdb.title || tmdb.name)) {
        let imdbId = tmdb.external_ids?.imdb_id || "";
        if (!imdbId) {
            const videasy =
                kind === "movie" ? await fetchVideasyMovie(id) : await fetchVideasyShow(id);
            if (videasy && (videasy.title || videasy.name)) {
                const result = { meta: videasy, source: "videasy" };
                cacheSet(_metaCache, cacheKey, result, 30 * 60 * 1000);
                return result;
            }
        } else {
            const result = { meta: tmdb, source: "tmdb" };
            cacheSet(_metaCache, cacheKey, result, 30 * 60 * 1000);
            return result;
        }
    }

    const videasy =
        kind === "movie" ? await fetchVideasyMovie(id) : await fetchVideasyShow(id);
    if (videasy && (videasy.title || videasy.name)) {
        const result = { meta: videasy, source: "videasy" };
        cacheSet(_metaCache, cacheKey, result, 30 * 60 * 1000);
        return result;
    }
    return null;
}

function metadataToPlayback(meta, kind, ids) {
    const title = kind === "movie" ? (meta.title || meta.name || "") : (meta.name || meta.title || "");
    const year = yearFromDate(meta.release_date || meta.first_air_date);
    const imdbId = meta.external_ids?.imdb_id || meta.imdb_id || "";
    const tmdbId = meta.id || ids.tmdbId;
    return { title, year, imdbId, tmdbId };
}

function pickStreamUrl(src) {
    if (!src || typeof src !== "object") return "";
    if (
        src.type === "hls" &&
        typeof src.playlist === "string" &&
        src.playlist.startsWith("http")
    ) {
        return src.playlist;
    }
    const candidates = [
        src.playlist,
        src.file,
        src.url,
        src.link,
        src.hls,
        src.stream,
        src.src,
    ];
    for (const c of candidates) {
        if (typeof c === "string" && c.startsWith("http")) return c;
    }
    if (Array.isArray(src.sources)) {
        for (const s of src.sources) {
            const u = pickStreamUrl(s);
            if (u) return u;
        }
    }
    return "";
}

function parseCaptionTracks(captions) {
    if (!Array.isArray(captions)) return [];
    return captions
        .map((sub) => {
            const url = sub.url || sub.file || sub.src || "";
            if (!url.startsWith("http")) return null;
            const label = sub.language || sub.label || sub.id || sub.name || "Subtitle";
            return {
                title: String(label),
                url,
                headers: LORDFLIX_HEADERS,
            };
        })
        .filter(Boolean);
}

function buildStreamObjects(streamsResult) {
    const objects = [];
    const allCaptions = [];

    for (const src of streamsResult) {
        const streamUrl = pickStreamUrl(src);
        if (!streamUrl) continue;
        const tracks = parseCaptionTracks(src.captions);
        if (tracks.length) allCaptions.push(...tracks);
        objects.push({
            title: src.id || src.name || src.label || src.server || "LordFlix",
            streamUrl,
            headers: LORDFLIX_HEADERS,
            allSubtitles: tracks,
        });
    }

    let subtitleUrl = "";
    if (allCaptions.length) {
        const english =
            allCaptions.find((t) => /english|eng/i.test(t.title)) || allCaptions[0];
        subtitleUrl = english.url;
    }

    return { streamObjects: objects, subtitleUrl, allCaptions };
}

async function decryptLordflixPayload(encryptedText, sign) {
    const decheaders = {
        "Content-Type": "application/json",
        Accept: "application/json",
    };
    const postData = JSON.stringify({ text: encryptedText, sign });
    const decryptedResponse = await fetchv2(
        "https://enc-dec.app/api/dec-lordflix",
        decheaders,
        "POST",
        postData
    );
    const decryptedData = await decryptedResponse.json();
    if (decryptedData.status !== 200) {
        throw new Error(decryptedData.message || "Decryption failed");
    }
    const result = decryptedData.result || {};
    let streamsResult =
        result.stream || result.streams || result.sources || result.data || [];
    if (!Array.isArray(streamsResult)) {
        streamsResult = streamsResult && typeof streamsResult === "object" ? [streamsResult] : [];
    }
    if (streamsResult.length === 0) {
        const apiErr = result.error || result.message;
        if (apiErr) throw new Error(String(apiErr));
    }
    return streamsResult;
}

async function fetchLordflixStreamsForUrl(encUrl) {
    const cached = cacheGet(_streamCache, encUrl);
    if (cached) return cached;

    const encResponse = await soraFetch(
        "https://enc-dec.app/api/enc-lordflix?url=" + encodeURIComponent(encUrl)
    );
    if (!encResponse) throw new Error("Encryption request failed");
    const encData = await encResponse.json();
    if (encData.status !== 200 || !encData.result) {
        throw new Error(encData.message || "Encryption failed");
    }

    const encryptedUrl = encData.result.url;
    const sign = encData.result.sign;
    const encryptedText = await fetchText(encryptedUrl, { headers: LORDFLIX_HEADERS });
    const streamsResult = await decryptLordflixPayload(encryptedText, sign);
    const built = buildStreamObjects(streamsResult);
    if (built.streamObjects.length) {
        cacheSet(_streamCache, encUrl, built, STREAM_CACHE_MS);
    }
    return built;
}

async function tryLordflixServer(meta) {
    const server = meta.server;
    try {
        const encUrl = buildSnowhouseUrl(meta);
        const built = await fetchLordflixStreamsForUrl(encUrl);
        if (built.streamObjects.length) {
            return { ok: true, built: built, server: server };
        }
        return { ok: false, error: server + ": empty stream list" };
    } catch (e) {
        return { ok: false, error: formatServerError(server, e) };
    }
}

function raceLordflixServers(meta, servers, streamType) {
    return new Promise(function (resolve, reject) {
        if (!servers.length) {
            reject(new Error("No playable stream found"));
            return;
        }
        var pending = servers.length;
        var errors = [];
        var settled = false;

        servers.forEach(function (server) {
            tryLordflixServer({ ...meta, type: streamType, server: server }).then(function (result) {
                if (settled) return;
                if (result.ok) {
                    settled = true;
                    resolve(result);
                    return;
                }
                if (result.error) errors.push(result.error);
                pending -= 1;
                if (pending === 0) {
                    reject(new Error(errors.slice(0, 3).join(" | ") || "No playable stream found"));
                }
            });
        });
    });
}

async function resolveLordflixPlayback(meta) {
    if (!meta.imdbId) {
        throw new Error("Missing IMDb ID from TMDB. Streams cannot be resolved for this title.");
    }

    const fallback =
        meta.type === "series" ? LORDFLIX_SERIES_FALLBACK : LORDFLIX_MOVIE_FALLBACK;
    const typesToTry = meta.type === "series" ? ["series", "tv"] : [meta.type];
    const errors = [];

    for (var ti = 0; ti < typesToTry.length; ti++) {
        var streamType = typesToTry[ti];

        var fast = await tryLordflixServer({ ...meta, type: streamType, server: FAST_SERVER });
        if (fast.ok) return fast.built;
        if (fast.error) errors.push(fast.error);

        try {
            var hit = await raceLordflixServers(meta, fallback, streamType);
            return hit.built;
        } catch (e) {
            errors.push(String(e.message || e));
        }
    }

    throw new Error(errors.slice(0, 3).join(" | ") || "No playable stream found");
}

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        let baseUrlTemplate = null;

        if (matchesKeyword(keyword, keywordGroups.trending)) {
            baseUrlTemplate = (page) => tmdbProxyUrl("trending/all/week", page);
        } else if (matchesKeyword(keyword, keywordGroups.topRatedMovie)) {
            baseUrlTemplate = (page) => tmdbProxyUrl("movie/top_rated", page);
        } else if (matchesKeyword(keyword, keywordGroups.topRatedTV)) {
            baseUrlTemplate = (page) => tmdbProxyUrl("tv/top_rated", page);
        } else if (matchesKeyword(keyword, keywordGroups.popularMovie)) {
            baseUrlTemplate = (page) => tmdbProxyUrl("movie/popular", page);
        } else if (matchesKeyword(keyword, keywordGroups.popularTV)) {
            baseUrlTemplate = (page) => tmdbProxyUrl("tv/popular", page);
        } else {
            baseUrlTemplate = (page) =>
                `${TMDB_PROXY}${encodeURIComponent(
                    `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodedKeyword}&include_adult=false&page=${page}`
                )}&simple=true`;
        }

        const skipTitleFilter = Object.values(keywordGroups).flat();
        const shouldFilter = !matchesKeyword(keyword, skipTitleFilter);

        const pageCount = shouldFilter ? 2 : 3;
        const pages = await Promise.all(
            Array.from({ length: pageCount }, (_, i) => fetchJson(baseUrlTemplate(i + 1)))
        );
        const dataResults = pages.flatMap((p) => p.results || []);

        const transformedResults = dataResults
            .map((result) => {
                if (result.media_type === "movie" || result.title) {
                    return {
                        title:
                            result.title ||
                            result.name ||
                            result.original_title ||
                            result.original_name ||
                            "Untitled",
                        image: result.poster_path
                            ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                            : "",
                        href: `movie/${result.id}`,
                    };
                }
                if (result.media_type === "tv" || result.name) {
                    return {
                        title:
                            result.name ||
                            result.title ||
                            result.original_name ||
                            result.original_title ||
                            "Untitled",
                        image: result.poster_path
                            ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                            : "",
                        href: `tv/${result.id}/1/1`,
                    };
                }
                return null;
            })
            .filter(Boolean)
            .filter((result) => result.title !== "Overflow")
            .filter(
                (r) =>
                    !shouldFilter ||
                    r.title.toLowerCase().includes(String(keyword).toLowerCase())
            );

        // Plain-text queries (anime download search) — surface TV series before movies.
        if (shouldFilter && transformedResults.length > 1) {
            transformedResults.sort((a, b) => {
                const aTv = String(a.href || "").startsWith("tv/") ? 0 : 1;
                const bTv = String(b.href || "").startsWith("tv/") ? 0 : 1;
                if (aTv !== bTv) return aTv - bTv;
                return String(a.title || "").localeCompare(String(b.title || ""));
            });
        }

        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("searchResults error: " + error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

async function extractDetails(url) {
    try {
        const path = normalizePath(url);
        if (path.includes("movie")) {
            const movieId = parseMovieId(path);
            if (!movieId) throw new Error("Invalid movie URL");
            const data = await fetchTmdbMovie(movieId);
            return JSON.stringify([
                {
                    description: data?.overview || "No description available",
                    aliases: `Duration: ${data?.runtime ? data.runtime + " minutes" : "Unknown"}`,
                    airdate: `Released: ${data?.release_date || "Unknown"}`,
                },
            ]);
        }
        if (path.includes("tv")) {
            const showId = path.match(/\/tv\/([^/?#]+)/i)?.[1];
            if (!showId) throw new Error("Invalid TV URL");
            const data = await fetchTmdbShow(showId);
            const runtime =
                data?.episode_run_time?.length
                    ? data.episode_run_time.join(", ") + " minutes"
                    : "Unknown";
            return JSON.stringify([
                {
                    description: data?.overview || "No description available",
                    aliases: `Duration: ${runtime}`,
                    airdate: `Aired: ${data?.first_air_date || "Unknown"}`,
                },
            ]);
        }
        throw new Error("Invalid URL format");
    } catch (error) {
        console.log("extractDetails error: " + error);
        return JSON.stringify([
            {
                description: "Error loading description",
                aliases: "Duration: Unknown",
                airdate: "Aired/Released: Unknown",
            },
        ]);
    }
}

function buildEpisodesFromSeasons(showId, seasons, seasonPayloads) {
    var allEpisodes = [];
    var globalNumber = 0;
    for (var si = 0; si < seasons.length; si++) {
        var season = seasons[si];
        var seasonNumber = season.season_number;
        if (seasonNumber === 0) continue;
        var seasonData = seasonPayloads[seasonNumber];
        if (!seasonData || !seasonData.episodes || !seasonData.episodes.length) continue;
        for (var ei = 0; ei < seasonData.episodes.length; ei++) {
            var episode = seasonData.episodes[ei];
            globalNumber += 1;
            allEpisodes.push({
                href: "/tv/" + showId + "/" + seasonNumber + "/" + episode.episode_number,
                number: globalNumber,
                title: episode.name || "Episode " + globalNumber,
            });
        }
    }
    return allEpisodes;
}

async function fetchAllShowEpisodes(showId, showData) {
    const cacheKey = "eps:" + showId;
    const cached = cacheGet(_episodeCache, cacheKey);
    if (cached) return cached;

    if (!showData?.seasons?.length) return [];

    const seasons = [...showData.seasons].sort(
        (a, b) => (a.season_number || 0) - (b.season_number || 0)
    );
    const seasonNumbers = seasons
        .map((s) => s.season_number)
        .filter((n) => n !== 0);

    const seasonResults = await Promise.all(
        seasonNumbers.map((n) =>
            fetchJson(tmdbProxyUrl("tv/" + showId + "/season/" + n)).catch(() => null)
        )
    );

    const payloads = {};
    seasonNumbers.forEach((n, i) => {
        if (seasonResults[i]) payloads[n] = seasonResults[i];
    });

    const episodes = buildEpisodesFromSeasons(showId, seasons, payloads);
    cacheSet(_episodeCache, cacheKey, episodes, 20 * 60 * 1000);
    return episodes;
}

async function extractEpisodes(url) {
    try {
        const path = normalizePath(url);
        if (path.includes("movie")) {
            return JSON.stringify([]);
        }
        if (path.includes("tv")) {
            const targeted = path.match(/\/tv\/([^/?#]+)\/(\d+)\/(\d+)/i);
            const showId = (targeted ? targeted[1] : path.match(/\/tv\/([^/?#]+)/i)?.[1]);
            if (!showId) throw new Error("Invalid TV URL");

            const showData = await fetchTmdbShow(showId);
            if (!showData?.seasons?.length) return JSON.stringify([]);

            if (targeted) {
                const seasonNum = parseInt(targeted[2], 10);
                const epNum = parseInt(targeted[3], 10);
                const seasonData = await fetchJson(
                    tmdbProxyUrl("tv/" + showId + "/season/" + seasonNum)
                ).catch(() => null);
                if (seasonData?.episodes?.length) {
                    const seasons = [...showData.seasons].sort(
                        (a, b) => (a.season_number || 0) - (b.season_number || 0)
                    );
                    let globalOffset = 0;
                    for (const s of seasons) {
                        if (s.season_number === 0) continue;
                        if (s.season_number < seasonNum) {
                            globalOffset += s.episode_count || 0;
                        }
                    }
                    const hit = seasonData.episodes.find(
                        (e) => e.episode_number === epNum
                    );
                    if (hit) {
                        return JSON.stringify([
                            {
                                href: "/tv/" + showId + "/" + seasonNum + "/" + epNum,
                                number: globalOffset + epNum,
                                title: hit.name || "Episode " + (globalOffset + epNum),
                            },
                        ]);
                    }
                }
            }

            const allEpisodes = await fetchAllShowEpisodes(showId, showData);
            return JSON.stringify(allEpisodes);
        }
        throw new Error("Invalid URL format");
    } catch (error) {
        console.log("extractEpisodes error: " + error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(ID) {
    try {
        const path = normalizePath(ID);
        if (path.includes("movie")) {
            const movieId = parseMovieId(path);
            if (!movieId) throw new Error("Invalid movie path");

            const loaded = await fetchStreamMetadata("movie", movieId);
            if (!loaded) throw new Error("Could not load movie metadata");
            const { meta } = loaded;

            if (isFutureDate(meta.release_date)) {
                throw new Error(
                    `This movie releases on ${meta.release_date}. Playback is not available yet.`
                );
            }

            const playback = metadataToPlayback(meta, "movie", { tmdbId: movieId });
            const built = await resolveLordflixPlayback({
                ...playback,
                type: "movie",
            });

            return JSON.stringify({
                streams: built.streamObjects,
                subtitles: built.subtitleUrl,
                allSubtitles: built.allCaptions,
            });
        }

        if (path.includes("tv")) {
            const tv = parseTvId(path);
            if (!tv) throw new Error("Invalid TV path");

            const loaded = await fetchStreamMetadata("tv", tv.showId);
            if (!loaded) throw new Error("Could not load show metadata");
            const { meta } = loaded;

            if (isFutureDate(meta.first_air_date)) {
                throw new Error(
                    `This series premieres on ${meta.first_air_date}. Episodes are not available yet.`
                );
            }

            const playback = metadataToPlayback(meta, "tv", { tmdbId: tv.showId });
            const built = await resolveLordflixPlayback({
                ...playback,
                type: "series",
                season: tv.season,
                episode: tv.episode,
            });

            return JSON.stringify({
                streams: built.streamObjects,
                subtitles: built.subtitleUrl,
                allSubtitles: built.allCaptions,
            });
        }

        throw new Error("Unsupported media path");
    } catch (error) {
        console.log("extractStreamUrl error: " + error);
        return JSON.stringify({ streams: [], subtitles: "", error: String(error) });
    }
}

async function soraFetch(url, options = {}) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? "GET",
            options.body ?? null
        );
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}

(function (g) {
    if (!g) return;
    g.searchResults = searchResults;
    g.extractDetails = extractDetails;
    g.extractEpisodes = extractEpisodes;
    g.extractStreamUrl = extractStreamUrl;
})(typeof globalThis !== "undefined" ? globalThis : this);
