const KISSASIAN_ORIGIN = "https://kissasian.cam";

function decodeHtmlEntities(text) {
    if (!text) return "";
    return text
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();
}

function seriesSlugFromUrl(url) {
    const seriesMatch = url.match(/kissasian\.cam\/series\/([^/?#]+)/i);
    if (seriesMatch) return seriesMatch[1].replace(/\/$/, "");
    const episodeMatch = url.match(/kissasian\.cam\/([^/?#]+)-episode-\d+/i);
    if (episodeMatch) return episodeMatch[1];
    const movieMatch = url.match(/kissasian\.cam\/([^/?#]+)\/?$/i);
    if (movieMatch && !movieMatch[1].startsWith("series")) return movieMatch[1];
    return null;
}

function normalizeEpisodeUrl(href) {
    if (!href) return null;
    if (href.startsWith("/")) return `${KISSASIAN_ORIGIN}${href}`;
    return href;
}

function isSkippableEmbed(url) {
    if (!url) return true;
    const u = url.toLowerCase();
    return (
        u.startsWith("about:") ||
        u.includes("drive.google.com") ||
        u.includes("docs.google.com") ||
        u.includes("youtube.com/embed") ||
        u === "#"
    );
}

function isDirectMediaUrl(url) {
    const base = (url || "").split("?")[0].toLowerCase();
    return base.endsWith(".mp4") || base.endsWith(".m3u8") || url.includes(".m3u8?");
}

function parseIframeSources(html) {
    const sources = [];
    const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let match;
    while ((match = iframeRegex.exec(html)) !== null) {
        const src = match[1].trim();
        if (!isSkippableEmbed(src)) sources.push(src);
    }
    return sources;
}

function parseEpisodeNumberFromHref(href) {
    const finale = href.match(/-episode-(\d+)-finale/i);
    if (finale) return parseInt(finale[1], 10);
    const standard = href.match(/-episode-(\d+)\/?$/i);
    if (standard) return parseInt(standard[1], 10);
    return null;
}

function parseEpisodesFromSeriesHtml(html) {
    const episodes = [];
    const seen = new Set();

    const rowRegex =
        /<li[^>]*>[\s\S]*?<a href="(https:\/\/kissasian\.cam\/[^"]+-episode[^"]*)"[\s\S]*?<div class="epl-num">(\d+)/gi;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
        const href = match[1].trim();
        const number = parseInt(match[2], 10);
        if (!seen.has(href)) {
            seen.add(href);
            episodes.push({ href, number });
        }
    }
    if (episodes.length) {
        episodes.sort((a, b) => a.number - b.number);
        return episodes;
    }

    const blockMatch =
        html.match(/<div class="eplister">([\s\S]*?)<\/div>\s*<\/div>/i) ||
        html.match(/<div class="bixbox bxcl epcheck">([\s\S]*?)<div class="bixbox"/i);
    const block = blockMatch ? blockMatch[1] : html;

    const linkRegex = /href="(https:\/\/kissasian\.cam\/[^"]+-episode[^"]*)"/gi;
    while ((match = linkRegex.exec(block)) !== null) {
        const href = match[1].trim();
        const number = parseEpisodeNumberFromHref(href);
        if (number == null || seen.has(href)) continue;
        seen.add(href);
        episodes.push({ href, number });
    }

    episodes.sort((a, b) => a.number - b.number);
    return episodes;
}

function parseMirrorPaths(html, episodeUrl) {
    const paths = [];
    const optionRegex = /<option[^>]+value=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = optionRegex.exec(html)) !== null) {
        const value = match[1].trim();
        if (value && value.includes("/v/")) {
            paths.push(normalizeEpisodeUrl(value));
        }
    }
    if (!paths.length && episodeUrl) {
        paths.push(episodeUrl.replace(/\/?$/, "/v/1/"));
        paths.push(episodeUrl.replace(/\/?$/, "/v/2/"));
        paths.push(episodeUrl.replace(/\/?$/, "/v/3/"));
    }
    return [...new Set(paths)];
}

async function fetchHtml(url) {
    const response = await soraFetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            Referer: `${KISSASIAN_ORIGIN}/`,
        },
    });
    return response.text();
}

async function searchResults(keyword) {
    try {
        const query = (keyword || "").trim();
        if (!query) return JSON.stringify([]);

        const searchUrl = `${KISSASIAN_ORIGIN}/?s=${encodeURIComponent(query)}`;
        const html = await fetchHtml(searchUrl);

        const results = [];
        const seen = new Set();
        const cardRegex =
            /<article class="bs"[\s\S]*?<a href="(https:\/\/kissasian\.cam\/series\/[^"]+)"[^>]*title="([^"]*)"[\s\S]*?<img[^>]+src="([^"]+)"[^>]*itemprop="image"/gi;

        let match;
        while ((match = cardRegex.exec(html)) !== null) {
            const href = match[1].trim();
            if (seen.has(href)) continue;
            seen.add(href);
            results.push({
                title: decodeHtmlEntities(match[2].trim()),
                href,
                image: match[3].trim(),
            });
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log("KissAsian searchResults error: " + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const html = await fetchHtml(url);

        let description = "No description available.";
        const metaDesc = html.match(/<meta name="description" content="([^"]+)"/i);
        if (metaDesc) {
            description = decodeHtmlEntities(metaDesc[1].trim());
        }

        const descBlock = html.match(/<div class="desc">([\s\S]*?)<\/div>/i);
        if (descBlock) {
            const cleaned = descBlock[1]
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, "")
                .replace(/\s+/g, " ")
                .trim();
            if (cleaned.length > 40) description = decodeHtmlEntities(cleaned);
        }

        const fields = {};
        const speRegex = /<span><b>([^<:]+):<\/b>\s*([^<]*)<\/span>/gi;
        let speMatch;
        while ((speMatch = speRegex.exec(html)) !== null) {
            const key = speMatch[1].trim();
            const value = decodeHtmlEntities(speMatch[2].trim());
            if (value) fields[key] = value;
        }

        const aliases = Object.entries(fields)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");

        const aired =
            fields["Released"] || fields["Aired"] || fields["Date"] || fields["Year"] || "";

        return JSON.stringify([
            {
                description,
                aliases,
                airdate: aired ? `Released: ${aired}` : "",
            },
        ]);
    } catch (error) {
        console.log("KissAsian extractDetails error: " + error);
        return JSON.stringify([
            {
                description: "Error loading description",
                aliases: "",
                airdate: "",
            },
        ]);
    }
}

async function extractEpisodes(url) {
    try {
        const pageUrl = url.replace(/\/?$/, "/");
        const html = await fetchHtml(pageUrl);

        let episodes = parseEpisodesFromSeriesHtml(html);

        if (episodes.length === 0 && pageUrl.includes("-episode-")) {
            const number = parseEpisodeNumberFromHref(pageUrl) || 1;
            episodes.push({ href: pageUrl, number });
        }

        if (episodes.length === 0) {
            const slug = seriesSlugFromUrl(pageUrl);
            if (slug) {
                const loose = new RegExp(
                    `href="(https://kissasian\\.cam/[^"]*${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*-episode[^"]*)"`,
                    "gi"
                );
                const seen = new Set();
                let match;
                while ((match = loose.exec(html)) !== null) {
                    const href = match[1].trim();
                    const number = parseEpisodeNumberFromHref(href);
                    if (number == null || seen.has(href)) continue;
                    seen.add(href);
                    episodes.push({ href, number });
                }
                episodes.sort((a, b) => a.number - b.number);
            }
        }

        if (episodes.length === 0 && !pageUrl.includes("/series/")) {
            episodes.push({ href: pageUrl, number: 1 });
        }

        return JSON.stringify(episodes);
    } catch (error) {
        console.log("KissAsian extractEpisodes error: " + error);
        return JSON.stringify([]);
    }
}

async function resolveEmbedStream(embedUrl, referer) {
    if (isSkippableEmbed(embedUrl)) return null;

    const refererHeader = referer || `${KISSASIAN_ORIGIN}/`;
    const baseHeaders = {
        Referer: refererHeader,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    };

    if (isDirectMediaUrl(embedUrl)) {
        return {
            title: embedUrl.includes(".m3u8") ? "HLS" : "MP4",
            streamUrl: embedUrl,
            headers: baseHeaders,
        };
    }

    const networkOptions = {
        timeoutSeconds: 45,
        cutoff: ".m3u8",
        headers: baseHeaders,
        maxWaitTime: 12,
    };

    let streams = await networkFetch(embedUrl, networkOptions);

    if (!streams.requests || streams.requests.length === 0) {
        const mp4Options = { ...networkOptions, cutoff: ".mp4" };
        streams = await networkFetch(embedUrl, mp4Options);
    }

    if (!streams.requests || streams.requests.length === 0) {
        return null;
    }

    const m3u8 = streams.requests.find((u) => u.includes(".m3u8"));
    const mp4 = streams.requests.find((u) => u.includes(".mp4"));
    const streamUrl = m3u8 || mp4 || streams.requests[0];
    if (!streamUrl) return null;

    const title = streamUrl.includes(".m3u8") ? "HLS" : "MP4";
    const headers = { Referer: referer || embedUrl };

    if (embedUrl.includes("justplay.cam")) {
        headers.Referer = "https://justplay.cam/";
        headers.Origin = "https://justplay.cam";
    } else if (embedUrl.includes("strcloud")) {
        headers.Referer = embedUrl;
    }

    return {
        title,
        streamUrl,
        headers,
    };
}

function parseSeriesCards(html, limit) {
    const results = [];
    const seen = new Set();
    const cardRegex =
        /<article class="bs"[\s\S]*?<a href="(https:\/\/kissasian\.cam\/series\/[^"]+)"[^>]*title="([^"]*)"[\s\S]*?<img[^>]+src="([^"]+)"[^>]*itemprop="image"/gi;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
        const href = match[1].trim();
        if (seen.has(href)) continue;
        seen.add(href);
        results.push({
            title: decodeHtmlEntities(match[2].trim()),
            href,
            image: match[3].trim(),
        });
        if (limit && results.length >= limit) break;
    }
    return results;
}

function parsePopularCards(html, limit) {
    const results = [];
    const seen = new Set();
    const regex =
        /<a class="series" href="(https:\/\/kissasian\.cam\/series\/[^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*title="([^"]*)"[\s\S]*?<\/a>\s*<\/div><div class="leftseries"><h4>\s*<a class="series" href="[^"]+"[^>]*>([^<]+)</gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const href = match[1].trim();
        if (seen.has(href)) continue;
        seen.add(href);
        results.push({
            title: decodeHtmlEntities((match[4] || match[3]).trim()),
            href,
            image: match[2].trim(),
        });
        if (limit && results.length >= limit) break;
    }
    return results;
}

function parseOngoingCards(html, limit) {
    const results = [];
    const seen = new Set();
    const regex =
        /<a href="(https:\/\/kissasian\.cam\/[^"]+-episode-\d+\/)"[^>]*title="([^"]+)"/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const episodeHref = match[1].trim();
        const title = decodeHtmlEntities(match[2].trim());
        const seriesHref = episodeHref.replace(/-episode-\d+\/?$/, "/");
        const seriesSlug = seriesHref.split("/").filter(Boolean).pop();
        const href = `https://kissasian.cam/series/${seriesSlug}/`;
        if (seen.has(href)) continue;
        seen.add(href);
        results.push({ title, href, image: "" });
        if (limit && results.length >= limit) break;
    }
    return results;
}

async function browseSections() {
    try {
        const sections = [];
        const homeHtml = await fetchHtml(`${KISSASIAN_ORIGIN}/`);

        const latest = parseSeriesCards(homeHtml, 18);
        if (latest.length) {
            sections.push({ id: "latest", title: "Latest Release", items: latest });
        }

        const popular = parsePopularCards(homeHtml, 18);
        if (popular.length) {
            sections.push({ id: "popular", title: "Popular This Week", items: popular });
        }

        const ongoing = parseOngoingCards(homeHtml, 16);
        if (ongoing.length) {
            sections.push({ id: "ongoing", title: "Ongoing", items: ongoing });
        }

        const genreFetches = [
            { id: "romance", title: "Romance", path: "/genres/romance/" },
            { id: "comedy", title: "Comedy", path: "/genres/comedy/" },
            { id: "action", title: "Action", path: "/genres/action/" },
            { id: "drama", title: "Drama", path: "/genres/drama/" },
            { id: "thriller", title: "Thriller", path: "/genres/thriller/" },
        ];

        await Promise.all(
            genreFetches.map(async (genre) => {
                try {
                    const html = await fetchHtml(`${KISSASIAN_ORIGIN}${genre.path}`);
                    const items = parseSeriesCards(html, 14);
                    if (items.length) {
                        sections.push({ id: genre.id, title: genre.title, items });
                    }
                } catch (e) {
                    console.log("KissAsian browse genre failed " + genre.id + ": " + e);
                }
            })
        );

        try {
            const moviesHtml = await fetchHtml(`${KISSASIAN_ORIGIN}/series/?type=Movie&order=update`);
            const movies = parseSeriesCards(moviesHtml, 14);
            if (movies.length) {
                sections.push({ id: "movies", title: "Movies", items: movies });
            }
        } catch (e) {
            console.log("KissAsian browse movies failed: " + e);
        }

        return JSON.stringify(sections);
    } catch (error) {
        console.log("KissAsian browseSections error: " + error);
        return JSON.stringify([]);
    }
}

function normalizeEpisodePageUrl(url) {
    let u = (url || "").trim();
    if (u.includes("/series/")) {
        return u.replace(/\/?$/, "/");
    }
    return u.replace(/\/v\/\d+\/?$/, "/").replace(/\/?$/, "/");
}

async function extractStreamUrl(url) {
    try {
        let episodeUrl = normalizeEpisodePageUrl(url);
        let mirrorPages = [];

        try {
            let html = await fetchHtml(episodeUrl);
            if (episodeUrl.includes("/series/")) {
                const eps = parseEpisodesFromSeriesHtml(html);
                if (eps.length) episodeUrl = eps[0].href;
                html = await fetchHtml(episodeUrl);
            }
            mirrorPages.push(...parseMirrorPaths(html, episodeUrl));
        } catch (e) {
            console.log("KissAsian mirror list fetch failed: " + e);
        }

        const pagesToTry = mirrorPages.length
            ? [...new Set(mirrorPages)]
            : [episodeUrl];

        const streams = [];
        let serverIndex = 0;

        for (const pageUrl of pagesToTry) {
            let html = "";
            try {
                html = await fetchHtml(pageUrl);
            } catch (e) {
                console.log("KissAsian page fetch failed " + pageUrl + ": " + e);
                continue;
            }

            const iframes = parseIframeSources(html);
            for (const embedUrl of iframes) {
                const resolved = await resolveEmbedStream(embedUrl, episodeUrl);
                if (!resolved) continue;
                serverIndex += 1;
                const host = (() => {
                    try {
                        return new URL(embedUrl).hostname.replace(/^www\./, "");
                    } catch (e) {
                        return `Server ${serverIndex}`;
                    }
                })();
                streams.push({
                    title: `Server ${serverIndex} (${host})`,
                    streamUrl: resolved.streamUrl,
                    headers: resolved.headers,
                });
            }
        }

        return JSON.stringify({ streams, subtitles: "" });
    } catch (error) {
        console.log("KissAsian extractStreamUrl error: " + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

(function (g) {
    if (!g) return;
    g.searchResults = searchResults;
    g.extractDetails = extractDetails;
    g.extractEpisodes = extractEpisodes;
    g.extractStreamUrl = extractStreamUrl;
    g.browseSections = browseSections;
})(typeof globalThis !== "undefined" ? globalThis : this);
