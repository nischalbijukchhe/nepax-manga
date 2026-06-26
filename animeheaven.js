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

function normalizeAnimePageUrl(url) {
    const absolute = absAnimeHeavenUrl(url);
    try {
        const parsed = new URL(absolute);
        if (parsed.hostname.replace(/^www\./, "") !== "animeheaven.me") {
            return absolute;
        }
        if (parsed.pathname.includes("anime.php") && parsed.search) {
            return `${AH_BASE}/anime.php${parsed.search}`;
        }
    } catch (e) {}
    return absolute;
}

function parseGateKey(url) {
    const text = String(url || "").trim();
    if (!text) return null;

    try {
        const parsed = new URL(text, AH_BASE);
        const keyParam = parsed.searchParams.get("key");
        if (keyParam) return keyParam.trim();
        if (parsed.hash && parsed.hash.length > 1) {
            return parsed.hash.replace(/^#/, "").trim();
        }
    } catch (e) {}

    const patterns = [
        /[?&]key=([a-f0-9]{32})/i,
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
    const response = await soraFetch(url, {
        headers: { ...AH_DEFAULT_HEADERS, ...extraHeaders },
    });
    if (!response) throw new Error("No response");
    return await response.text();
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
    if (normalized !== original) attempts.push(original);

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

async function searchResults(keyword) {
    try {
        const query = String(keyword || "").trim();
        if (!query) return JSON.stringify([]);

        const attempts = buildSearchAttempts(query);
        let results = [];

        for (const attempt of attempts) {
            try {
                const html = await fetchSearchHtml(attempt);
                if (!searchPageHasNoResults(html)) {
                    results = parseSearchPageResults(html);
                    if (results.length) break;
                }
            } catch (e) {
                console.log("AnimeHeaven search.php attempt failed: " + e);
            }
        }

        if (!results.length) {
            for (const attempt of attempts) {
                try {
                    const fastHtml = await fetchFastSearchHtml(attempt);
                    results = parseFastSearchResults(fastHtml);
                    if (results.length) break;
                } catch (e) {
                    console.log("AnimeHeaven fastsearch attempt failed: " + e);
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
        const pageUrl = normalizeAnimePageUrl(url);
        const html = await fetchHtml(pageUrl);

        const episodes = [];
        const seen = new Set();
        const regex =
            /<a[^>]+onclick=['"]gatea\(['"]([^'"]+)['"]\)[^>]*>[\s\S]*?<div class=['"]watch2 bc[^'"]*['"]>\s*(\d+)\s*<\/div>/gi;

        let match;
        while ((match = regex.exec(html)) !== null) {
            const gateId = match[1].trim();
            const number = parseInt(match[2], 10);
            if (!gateId || !Number.isFinite(number) || seen.has(number)) continue;
            seen.add(number);
            episodes.push({
                href: gateEpisodeHref(gateId),
                number,
            });
        }

        episodes.sort((a, b) => a.number - b.number);
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

        sources.sort((a, b) => {
            const score = (s) => {
                const u = s.src.toLowerCase();
                if (u.includes(".mp4")) return 3;
                if (u.includes(".m3u8")) return 2;
                return 1;
            };
            return score(b) - score(a);
        });

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
