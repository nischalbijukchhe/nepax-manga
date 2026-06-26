const AH_BASE = "https://animeheaven.me";

const AH_DEFAULT_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Referer: AH_BASE + "/",
};

function decodeHtmlEntities(text) {
    return String(text || "")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function absAnimeHeavenUrl(path) {
    const raw = String(path || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("//")) return "https:" + raw;
    if (raw.startsWith("/")) return AH_BASE + raw;
    return AH_BASE + "/" + raw;
}

function parseAnimeHeavenSeriesId(url) {
    const text = String(url || "").trim();
    if (!text) return null;

    const direct = text.match(/anime\.php\?([a-z0-9]+)/i);
    if (direct) return direct[1].toLowerCase();

    if (/^[a-z0-9]{4,12}$/i.test(text)) return text.toLowerCase();

    try {
        const parsed = new URL(text, AH_BASE);
        const pathMatch = parsed.pathname.match(/anime\.php/i);
        if (pathMatch) {
            const query = parsed.search.replace(/^\?/, "").trim();
            const id = query.split("&")[0];
            if (/^[a-z0-9]{4,12}$/i.test(id)) return id.toLowerCase();
        }
    } catch (e) {}

    return null;
}

function buildAnimePageUrl(urlOrId) {
    const id = parseAnimeHeavenSeriesId(urlOrId);
    if (id) return `${AH_BASE}/anime.php?${id}`;
    return absAnimeHeavenUrl(urlOrId);
}

function normalizeAnimePageUrl(url) {
    return buildAnimePageUrl(url);
}

function buildEpisodeHref(animeId, gateId) {
    const seriesId = parseAnimeHeavenSeriesId(animeId) || "";
    if (seriesId) {
        return `${AH_BASE}/anime.php?${seriesId}#gate=${encodeURIComponent(gateId)}`;
    }
    return gateEpisodeHref(gateId);
}

function extractEpisodeSectionHtml(html) {
    const text = String(html || "");
    const start = text.search(/class=['"]linetitle2/i);
    if (start < 0) return text;

    const tail = text.slice(start);
    const endMatch = tail.search(
        /class=['"]linetitle c['"]>Related Shows|class=['"]linetitle c['"]>Similar Shows|<div class=['"]footer/i
    );
    return endMatch > 0 ? tail.slice(0, endMatch) : tail;
}

function parseEpisodesFromHtml(html, animeId) {
    const section = extractEpisodeSectionHtml(html);
    const episodes = [];
    const seenNumbers = new Set();
    const seenGateIds = new Set();

    function pushEpisode(gateId, number) {
        const id = String(gateId || "").trim();
        const epNum = parseInt(number, 10);
        if (!id || !Number.isFinite(epNum) || epNum <= 0) return;
        if (seenNumbers.has(epNum) || seenGateIds.has(id)) return;
        seenNumbers.add(epNum);
        seenGateIds.add(id);
        episodes.push({
            href: buildEpisodeHref(animeId, id),
            number: epNum,
        });
    }

    // Primary: gatea() + watch2 episode number (AnimeHeaven layout)
    const primaryRe =
        /onclick=['"]gatea\(['"]([^'"]+)['"]\)[^>]*>[\s\S]*?<div class=['"]watch2 bc[^'"]*['"]>\s*(\d+)\s*<\/div>/gi;
    let match;
    while ((match = primaryRe.exec(section)) !== null) {
        pushEpisode(match[1], match[2]);
    }

    // Fallback: gatea id attribute + nearby watch2 (handles spacing/quote variants)
    const anchorRe = /<a[^>]+onclick=['"]gatea\(['"]([^'"]+)['"]\)[^>]*id=['"]([^'"]+)['"][^>]*>[\s\S]*?<\/a>/gi;
    while ((match = anchorRe.exec(section)) !== null) {
        const gateId = match[1] || match[2];
        const block = match[0];
        const numMatch = block.match(/class=['"]watch2 bc[^'"]*['"]>\s*(\d+)\s*</i);
        if (numMatch) pushEpisode(gateId, numMatch[1]);
    }

    // Last resort: numbered gate ids in order (page lists newest first)
    if (!episodes.length) {
        const gateOnly = [];
        const gateRe = /onclick=['"]gatea\(['"]([^'"]+)['"]\)/gi;
        while ((match = gateRe.exec(section)) !== null) {
            const gateId = match[1].trim();
            if (gateId && !seenGateIds.has(gateId)) {
                seenGateIds.add(gateId);
                gateOnly.push(gateId);
            }
        }
        gateOnly.reverse();
        gateOnly.forEach((gateId, index) => {
            pushEpisode(gateId, index + 1);
        });
    }

    episodes.sort((a, b) => a.number - b.number);
    return episodes;
}

function parseGateKey(url) {
    const text = String(url || "").trim();
    if (!text) return null;

    try {
        const parsed = new URL(text, AH_BASE);
        const keyParam = parsed.searchParams.get("key");
        if (keyParam) return keyParam.trim();
        if (parsed.hash && parsed.hash.length > 1) {
            const hash = parsed.hash.replace(/^#/, "").trim();
            const gateFromHash = hash.match(/(?:^|&)gate=([^&]+)/i);
            if (gateFromHash) return decodeURIComponent(gateFromHash[1]);
            if (/^[a-f0-9]{32}$/i.test(hash)) return hash;
        }
    } catch (e) {}

    const patterns = [
        /[?&]key=([a-f0-9]{32})/i,
        /#gate=([a-f0-9]{32})/i,
        /gate=([a-f0-9]{32})/i,
        /gate\.php[#?]([a-f0-9]{32})/i,
        /gatea\(['"]([a-f0-9]{32})['"]\)/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

function gateEpisodeHref(gateId) {
    return `${AH_BASE}/gate.php?key=${encodeURIComponent(gateId)}`;
}

async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
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

async function fetchHtml(url, extraHeaders = {}) {
    const headers = { ...AH_DEFAULT_HEADERS, ...extraHeaders };
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await soraFetch(url, { headers });
            if (!response) throw new Error("No response");
            const html = await response.text();
            if (html && html.length > 500) return html;
            lastError = new Error("Empty HTML response");
        } catch (error) {
            lastError = error;
        }
        headers["User-Agent"] =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    }

    throw lastError || new Error("Failed to fetch page");
}

function normalizeSearchQuery(keyword) {
    let q = String(keyword || "").trim();
    // "Re:ZERO -Starting..." → "Re:ZERO Starting..." (site rejects the hyphen form)
    q = q.replace(/\s+-\s*(?=[A-Za-z])/g, " ");
    q = q.replace(/\s+/g, " ").trim();
    return q;
}

function buildSearchAttempts(keyword) {
    const original = String(keyword || "").trim();
    const normalized = normalizeSearchQuery(original);
    const attempts = [normalized];

    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length > 5) attempts.push(words.slice(0, 5).join(" "));
    if (words.length > 3) attempts.push(words.slice(0, 3).join(" "));
    if (/re\s*:?\s*zero/i.test(normalized)) attempts.push("Re:ZERO");

    return [...new Set(attempts.filter(Boolean))];
}

function parseSearchPageResults(html) {
    const results = [];
    const seen = new Set();

    function pushResult(id, imageId, title) {
        const href = `${AH_BASE}/anime.php?${String(id).trim()}`;
        if (!id || seen.has(href)) return;
        seen.add(href);
        results.push({
            title: decodeHtmlEntities(String(title || "").trim()),
            image: absAnimeHeavenUrl(`image.php?${String(imageId || "").trim()}`),
            href,
        });
    }

    // Primary: cover card on search.php
    const cardRe =
        /<a href=['"]anime\.php\?([^'"]+)['"][^>]*>[\s\S]*?src=['"]\/?image\.php\?([^'"]+)['"][^>]*alt=['"]([^'"]+)['"]/gi;
    let match;
    while ((match = cardRe.exec(html)) !== null) {
        pushResult(match[1], match[2], match[3]);
    }

    // Fallback: title link + nearby cover in similarimg block
    const blockRe = /class=['"]similarimg['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    while ((match = blockRe.exec(html)) !== null) {
        const block = match[1];
        const hrefM = block.match(/href=['"]anime\.php\?([^'"]+)['"]/i);
        const imgM = block.match(/src=['"]\/?image\.php\?([^'"]+)['"]/i);
        const titleM =
            block.match(/class=['"]similarname[^'"]*['"][^>]*>[\s\S]*?>([^<]+)</i) ||
            block.match(/alt=['"]([^'"]+)['"]/i);
        if (hrefM) pushResult(hrefM[1], imgM?.[1] || "", titleM?.[1] || "");
    }

    return results;
}

function parseFastSearchResults(html) {
    const results = [];
    const seen = new Set();

    const itemRe =
        /<a[^>]+href=['"]\/?anime\.php\?([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = itemRe.exec(html)) !== null) {
        const id = match[1].trim();
        const block = match[2];
        const imgM = block.match(/src=['"]\/?image\.php\?([^'"]+)['"]/i);
        const titleM =
            block.match(/class=['"]fastname['"]>([^<]+)</i) ||
            block.match(/alt=['"]([^'"]+)['"]/i);
        const href = `${AH_BASE}/anime.php?${id}`;
        if (!id || seen.has(href)) continue;
        seen.add(href);
        results.push({
            title: decodeHtmlEntities((titleM?.[1] || "").trim()),
            image: absAnimeHeavenUrl(`image.php?${(imgM?.[1] || "").trim()}`),
            href,
        });
    }

    return results;
}

function rankSearchResults(keyword, results) {
    if (!Array.isArray(results) || results.length <= 1) return results;
    const tokens = normalizeSearchQuery(keyword)
        .toLowerCase()
        .replace(/[^a-z0-9: ]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    const scored = results.map((item) => {
        const title = String(item.title || "").toLowerCase();
        let score = 0;
        for (const token of tokens) {
            if (title.includes(token)) score += 10;
        }
        if (title.includes(tokens.slice(0, 3).join(" "))) score += 25;
        return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
}

async function fetchSearchHtml(query) {
    return await fetchHtml(`${AH_BASE}/search.php?s=${encodeURIComponent(query)}`);
}

async function fetchFastSearchHtml(query) {
    return await fetchHtml(`${AH_BASE}/fastsearch.php?xhr=1&s=${encodeURIComponent(query)}`);
}

function searchPageHasNoResults(html) {
    return /No results found/i.test(html) || !/anime\.php\?/i.test(html);
}

async function tryFastSearch(query) {
    const fastHtml = await fetchFastSearchHtml(query);
    return parseFastSearchResults(fastHtml);
}

async function trySearchPage(query) {
    const html = await fetchSearchHtml(query);
    if (searchPageHasNoResults(html)) return [];
    return parseSearchPageResults(html);
}

async function searchResults(keyword) {
    try {
        const query = String(keyword || "").trim();
        if (!query) return JSON.stringify([]);

        const attempts = buildSearchAttempts(query);
        let results = [];

        for (const attempt of attempts) {
            try {
                results = await tryFastSearch(attempt);
                if (results.length) break;
            } catch (e) {
                console.log("AnimeHeaven fastsearch attempt failed: " + e);
            }
        }

        if (!results.length) {
            for (const attempt of attempts) {
                try {
                    results = await trySearchPage(attempt);
                    if (results.length) break;
                } catch (e) {
                    console.log("AnimeHeaven search.php attempt failed: " + e);
                }
            }
        }

        results = rankSearchResults(query, results);
        return JSON.stringify(results);
    } catch (error) {
        console.log("AnimeHeaven searchResults error: " + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const pageUrl = normalizeAnimePageUrl(url);
        const html = await fetchHtml(pageUrl);

        const titleMatch = html.match(/<div class='infotitle c'>([^<]+)</i);
        const descMatch = html.match(/<div class='infodes c'>([\s\S]*?)<\/div>/i);
        const altTitleMatch = html.match(/<div class='infotitle2 c'>([^<]+)</i);
        const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : "";

        let description = "No description available.";
        if (descMatch) {
            description = decodeHtmlEntities(
                descMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            );
        }

        const metaParts = [];
        if (altTitleMatch) {
            metaParts.push(`Japanese: ${decodeHtmlEntities(altTitleMatch[1].trim())}`);
        }
        const episodesMatch = html.match(/Episodes:\s*<\/div>\s*(\d+)/i);
        if (episodesMatch) metaParts.push(`Episodes: ${episodesMatch[1]}`);
        const yearMatch = html.match(/Year:\s*<\/div>\s*(\d{4})/i);
        if (yearMatch) metaParts.push(`Year: ${yearMatch[1]}`);
        const scoreMatch = html.match(/Score:\s*<\/div>\s*([\d.]+)/i);
        if (scoreMatch) metaParts.push(`Score: ${scoreMatch[1]}/10`);

        const tagMatches = html.match(/tags\.php\?tag=([^'"]+)/gi) || [];
        const tags = [];
        const seenTags = new Set();
        for (const tagHref of tagMatches) {
            const tag = decodeHtmlEntities(
                tagHref.replace(/.*tag=/i, "").replace(/\+/g, " ").trim()
            );
            if (tag && !seenTags.has(tag.toLowerCase())) {
                seenTags.add(tag.toLowerCase());
                tags.push(tag);
            }
        }

        const aliases = [
            metaParts.length ? metaParts.join("\n") : "",
            tags.length ? `Tags: ${tags.join(", ")}` : "",
        ]
            .filter(Boolean)
            .join("\n");
        const countdownMatch = html.match(/Countdown to Episode\s+(\d+)/i);
        const airdate = countdownMatch
            ? `Next episode: ${countdownMatch[1]}`
            : title
              ? `Series: ${title}`
              : "Aired: Unknown";

        return JSON.stringify([
            {
                description,
                aliases,
                airdate,
            },
        ]);
    } catch (error) {
        console.log("AnimeHeaven extractDetails error: " + error);
        return JSON.stringify([
            {
                description: "Error loading description",
                aliases: "",
                airdate: "Unknown",
            },
        ]);
    }
}

async function extractEpisodes(url) {
    try {
        const animeId = parseAnimeHeavenSeriesId(url);
        const pageUrl = buildAnimePageUrl(url);
        if (!animeId) {
            console.log("AnimeHeaven extractEpisodes: invalid series url " + url);
            return JSON.stringify([]);
        }

        console.log("AnimeHeaven extractEpisodes: " + pageUrl);
        const html = await fetchHtml(pageUrl);
        const episodes = parseEpisodesFromHtml(html, animeId);

        console.log("AnimeHeaven episodes found: " + episodes.length);
        return JSON.stringify(episodes);
    } catch (error) {
        console.log("AnimeHeaven extractEpisodes error: " + error);
        return JSON.stringify([]);
    }
}

function parseStreamSources(html) {
    const out = [];
    const seen = new Set();

    function add(src, title) {
        const full = absAnimeHeavenUrl(src);
        if (!full || seen.has(full)) return;
        if (!/\.(mp4|m3u8|mkv|webm)(\?|$)/i.test(full) && !full.includes("&d")) return;
        seen.add(full);
        out.push({ src: full, title: title || "AnimeHeaven" });
    }

    let match;
    const sourceRe = /<source[^>]+src=['"]([^'"]+)['"]/gi;
    while ((match = sourceRe.exec(html)) !== null) {
        add(match[1], "Source");
    }

    const videoRe = /<video[^>]+src=['"]([^'"]+)['"]/gi;
    while ((match = videoRe.exec(html)) !== null) {
        add(match[1], "Video");
    }

    const downloadRe = /href=['"]([^'"]*&d[^'"]*)['"]/gi;
    while ((match = downloadRe.exec(html)) !== null) {
        add(match[1], "Download");
    }

    const downloadTextRe = /href=['"]([^'"]+)['"][^>]*>\s*Download/gi;
    while ((match = downloadTextRe.exec(html)) !== null) {
        add(match[1], "Download");
    }

    const inlineRe =
        /(?:file|src|url|video)\s*[:=]\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/gi;
    while ((match = inlineRe.exec(html)) !== null) {
        add(match[1], "Stream");
    }

    return out;
}

function isBrokenAnimeHeavenStream(url) {
    const u = String(url || "").toLowerCase();
    return /(?:&|\?)error\d*(?:&|$)/i.test(u);
}

function streamQualityScore(src) {
    const u = String(src || "").toLowerCase();
    if (isBrokenAnimeHeavenStream(u)) return 0;
    if (u.includes(".mp4") && !u.includes("&d")) return 4;
    if (u.includes(".mp4") && u.includes("&d")) return 3;
    if (u.includes(".m3u8")) return 2;
    return 1;
}
function streamHeadersFor(url) {
    return {
        Referer: `${AH_BASE}/gate.php`,
        Origin: AH_BASE,
        "User-Agent": AH_DEFAULT_HEADERS["User-Agent"],
    };
}

async function captureStreamsWithNetworkFetch(gateUrl, headers) {
    if (typeof networkFetch !== "function") return [];

    const cutoffs = [".mp4", ".m3u8", ".mkv"];
    const found = [];
    const seen = new Set();

    for (const cutoff of cutoffs) {
        try {
            const captured = await networkFetch(gateUrl, {
                headers,
                cutoff,
                timeoutSeconds: 28,
                waitForSelectors: ["video", "source", "a"],
                clickSelectors: [],
                maxWaitTime: 14,
            });
            const requests = captured?.requests || [];
            for (const req of requests) {
                const url = String(req || "").trim();
                if (!url || seen.has(url)) continue;
                if (!/\.(mp4|m3u8|mkv|webm)(\?|$)/i.test(url)) continue;
                seen.add(url);
                found.push(url);
            }
        } catch (e) {
            console.log(`AnimeHeaven networkFetch (${cutoff}): ${e}`);
        }
        if (found.length) break;
    }

    return found;
}

async function extractStreamUrl(url) {
    try {
        const gateKey = parseGateKey(url);
        if (!gateKey) {
            // Episode links use anime.php?id#gate=HASH — resolve gate from series page if needed.
            const animeId = parseAnimeHeavenSeriesId(url);
            if (animeId) {
                try {
                    const html = await fetchHtml(buildAnimePageUrl(animeId));
                    const episodes = parseEpisodesFromHtml(html, animeId);
                    const epNumMatch = String(url).match(/(?:[?&#]|^)ep=(\d+)/i);
                    const wanted = epNumMatch ? parseInt(epNumMatch[1], 10) : NaN;
                    const ep = Number.isFinite(wanted)
                        ? episodes.find((item) => item.number === wanted)
                        : episodes[0];
                    if (ep) {
                        const resolvedKey = parseGateKey(ep.href);
                        if (resolvedKey) {
                            return await extractStreamUrl(`${AH_BASE}/anime.php?${animeId}#gate=${resolvedKey}`);
                        }
                    }
                } catch (e) {
                    console.log("AnimeHeaven stream resolve from series page failed: " + e);
                }
            }
            return JSON.stringify({
                streams: [],
                subtitles: "",
                error: "Invalid AnimeHeaven episode link.",
            });
        }

        const gateUrl = `${AH_BASE}/gate.php`;
        const headers = {
            ...AH_DEFAULT_HEADERS,
            Cookie: `key=${gateKey}`,
        };

        let html = "";
        try {
            const response = await soraFetch(gateUrl, { headers });
            if (response) html = await response.text();
        } catch (e) {
            console.log("AnimeHeaven gate fetch failed: " + e);
        }

        let sources = parseStreamSources(html);

        if (!sources.length) {
            const captured = await captureStreamsWithNetworkFetch(gateUrl, headers);
            sources = captured.map((src, index) => ({
                src,
                title: captured.length > 1 ? `Stream ${index + 1}` : "AnimeHeaven",
            }));
        }

        if (!sources.length) {
            return JSON.stringify({
                streams: [],
                subtitles: "",
                error: "No video source found for this episode.",
            });
        }

        sources = sources.filter((item) => !isBrokenAnimeHeavenStream(item.src));

        if (!sources.length) {
            return JSON.stringify({
                streams: [],
                subtitles: "",
                error: "No working video source found for this episode.",
            });
        }

        sources.sort((a, b) => streamQualityScore(b.src) - streamQualityScore(a.src));

        const playHeaders = streamHeadersFor(sources[0].src);
        const streams = sources.map((item, index) => ({
            title:
                sources.length > 1
                    ? `${item.title} ${index + 1}`
                    : item.title || "AnimeHeaven",
            streamUrl: item.src,
            headers: playHeaders,
        }));

        return JSON.stringify({
            streams,
            subtitles: "",
        });
    } catch (error) {
        console.log("AnimeHeaven extractStreamUrl error: " + error);
        return JSON.stringify({
            streams: [],
            subtitles: "",
            error: String(error),
        });
    }
}

(function (g) {
    if (!g) return;
    g.searchResults = searchResults;
    g.extractDetails = extractDetails;
    g.extractEpisodes = extractEpisodes;
    g.extractStreamUrl = extractStreamUrl;
})(typeof globalThis !== "undefined" ? globalThis : this);
