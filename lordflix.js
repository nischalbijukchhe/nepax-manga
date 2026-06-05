// LordFlix — TMDB browse + lordflix.club streams (NEPAX/Shirox build)
// v1.1.0 — multi-server fallback, safer parsing, global TV episode numbers

const TMDB_KEY = "9801b6b0548ad57581d111ea690c85c8";
const TMDB_PROXY = "https://post-eosin.vercel.app/api/proxy?url=";
const LORDFLIX_SERVERS = ["Berlin", "London", "Paris", "Raleigh", "Sydney", "Hong Kong"];
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

function tmdbProxyUrl(path, page) {
    let url = `https://api.themoviedb.org/3/${path}?api_key=${TMDB_KEY}&include_adult=false`;
    if (page != null) url += `&page=${page}`;
    return `${TMDB_PROXY}${encodeURIComponent(url)}&simple=true`;
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

async function fetchTmdbMovie(movieId) {
    try {
        return await fetchJson(tmdbProxyUrl(`movie/${movieId}`));
    } catch (e) {
        console.log("TMDB movie fetch failed: " + e);
        return null;
    }
}

async function fetchTmdbShow(showId) {
    try {
        return await fetchJson(tmdbProxyUrl(`tv/${showId}`));
    } catch (e) {
        console.log("TMDB show fetch failed: " + e);
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

function buildSnowhouseUrl({ title, type, year, imdbId, tmdbId, season, episode, server }) {
    const params = new URLSearchParams();
    params.set("title", title);
    params.set("type", type);
    if (year) params.set("year", year);
    if (imdbId) params.set("imdb", imdbId);
    if (tmdbId) params.set("tmdb", String(tmdbId));
    params.set("server", server);
    if (season) params.set("season", String(season));
    if (episode) params.set("episode", String(episode));
    return `https://snowhouse.lordflix.club/?${params.toString()}`;
}

function pickStreamUrl(src) {
    if (!src || typeof src !== "object") return "";
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
    const streamsResult =
        result.stream || result.streams || result.sources || result.data || [];
    return Array.isArray(streamsResult) ? streamsResult : [];
}

async function fetchLordflixStreamsForUrl(encUrl) {
    const encResponse = await soraFetch(
        `https://enc-dec.app/api/enc-lordflix?url=${encodeURIComponent(encUrl)}`
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
    return buildStreamObjects(streamsResult);
}

async function resolveLordflixPlayback(meta) {
    const errors = [];
    for (const server of LORDFLIX_SERVERS) {
        try {
            const encUrl = buildSnowhouseUrl({ ...meta, server });
            const built = await fetchLordflixStreamsForUrl(encUrl);
            if (built.streamObjects.length) {
                console.log(`LordFlix stream OK via ${server}`);
                return built;
            }
            errors.push(`${server}: empty stream list`);
        } catch (e) {
            errors.push(`${server}: ${e}`);
            console.log(`LordFlix ${server} failed: ${e}`);
        }
    }
    throw new Error(errors.join(" | ") || "No playable stream found");
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

        const pages = await Promise.all(
            Array.from({ length: 5 }, (_, i) => fetchJson(baseUrlTemplate(i + 1)))
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

async function extractEpisodes(url) {
    try {
        const path = normalizePath(url);
        if (path.includes("movie")) {
            // Movies play from the detail href — no episode list (lordflix.org treats films as one title).
            return JSON.stringify([]);
        }
        if (path.includes("tv")) {
            const showId = path.match(/\/tv\/([^/?#]+)/i)?.[1];
            if (!showId) throw new Error("Invalid TV URL");
            const showData = await fetchTmdbShow(showId);
            if (!showData?.seasons?.length) return JSON.stringify([]);

            let allEpisodes = [];
            let globalNumber = 0;
            const seasons = [...showData.seasons].sort(
                (a, b) => (a.season_number || 0) - (b.season_number || 0)
            );

            for (const season of seasons) {
                const seasonNumber = season.season_number;
                if (seasonNumber === 0) continue;
                const seasonData = await fetchJson(
                    tmdbProxyUrl(`tv/${showId}/season/${seasonNumber}`)
                );
                if (!seasonData?.episodes?.length) continue;
                for (const episode of seasonData.episodes) {
                    globalNumber += 1;
                    allEpisodes.push({
                        href: `/tv/${showId}/${seasonNumber}/${episode.episode_number}`,
                        number: globalNumber,
                        title: episode.name || `Episode ${globalNumber}`,
                    });
                }
            }
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

            const [tmdb, videasy] = await Promise.all([
                fetchTmdbMovie(movieId),
                fetchVideasyMovie(movieId),
            ]);
            const meta = { ...(tmdb || {}), ...(videasy || {}) };
            if (!meta.id && !meta.title && !meta.name) {
                throw new Error("Could not load movie metadata");
            }

            let imdbId = meta.external_ids?.imdb_id || meta.imdb_id || "";
            if (!imdbId && tmdb?.id) {
                try {
                    const ext = await fetchJson(tmdbProxyUrl(`movie/${movieId}/external_ids`));
                    imdbId = ext?.imdb_id || "";
                } catch (_) {}
            }

            const title = meta.title || meta.name || "";
            const year = yearFromDate(meta.release_date || meta.first_air_date);
            const tmdbId = meta.id || movieId;

            if (meta.release_date) {
                const release = new Date(meta.release_date);
                if (!Number.isNaN(release.getTime()) && release > new Date()) {
                    throw new Error(
                        `This movie releases on ${meta.release_date}. Playback is not available yet.`
                    );
                }
            }

            const built = await resolveLordflixPlayback({
                title,
                type: "movie",
                year,
                imdbId,
                tmdbId,
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

            const [tmdb, videasy] = await Promise.all([
                fetchTmdbShow(tv.showId),
                fetchVideasyShow(tv.showId),
            ]);
            const meta = videasy || tmdb;
            if (!meta) throw new Error("Could not load show metadata");

            const title = meta.name || meta.title || "";
            const year = yearFromDate(meta.first_air_date || meta.release_date);
            const imdbId = meta.external_ids?.imdb_id || meta.imdb_id || "";
            const tmdbId = meta.id || tv.showId;

            const built = await resolveLordflixPlayback({
                title,
                type: "series",
                year,
                imdbId,
                tmdbId,
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
