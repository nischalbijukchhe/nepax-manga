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

function parseIframeSources(html) {
    const sources = [];
    const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let match;
    while ((match = iframeRegex.exec(html)) !== null) {
        const src = match[1].trim();
        if (src && !src.startsWith("about:")) sources.push(src);
    }
    return sources;
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
        const slug = seriesSlugFromUrl(url);
        if (!slug) return JSON.stringify([]);

        const html = await fetchHtml(url);
        const episodePattern = new RegExp(
            `href="https://kissasian\\.cam/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-episode-(\\d+)/"`,
            "gi"
        );

        const episodes = [];
        const seen = new Set();
        let match;
        while ((match = episodePattern.exec(html)) !== null) {
            const number = parseInt(match[1], 10);
            const href = `https://kissasian.cam/${slug}-episode-${number}/`;
            if (!seen.has(href)) {
                seen.add(href);
                episodes.push({ href, number });
            }
        }

        if (episodes.length === 0) {
            const movieHref = `https://kissasian.cam/${slug}/`;
            if (html.includes(movieHref) || html.includes(`/${slug}/"`)) {
                episodes.push({ href: movieHref, number: 1 });
            }
        }

        episodes.sort((a, b) => a.number - b.number);
        return JSON.stringify(episodes);
    } catch (error) {
        console.log("KissAsian extractEpisodes error: " + error);
        return JSON.stringify([]);
    }
}

async function resolveEmbedStream(embedUrl, referer) {
    const networkOptions = {
        timeoutSeconds: 45,
        cutoff: ".m3u8",
        headers: {
            Referer: referer || `${KISSASIAN_ORIGIN}/`,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
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

async function extractStreamUrl(url) {
    try {
        const episodeUrl = url.replace(/\/v\/\d+\/?$/, "/").replace(/\/?$/, "/");
        const pagesToTry = [episodeUrl];

        try {
            const html = await fetchHtml(episodeUrl);
            pagesToTry.push(...parseMirrorPaths(html, episodeUrl));
        } catch (e) {
            console.log("KissAsian mirror list fetch failed: " + e);
        }

        const embedCandidates = [];
        for (const pageUrl of [...new Set(pagesToTry)]) {
            try {
                const html = await fetchHtml(pageUrl);
                const iframes = parseIframeSources(html);
                for (const src of iframes) {
                    if (!embedCandidates.includes(src)) embedCandidates.push(src);
                }
            } catch (e) {
                console.log("KissAsian page fetch failed " + pageUrl + ": " + e);
            }
        }

        embedCandidates.sort((a, b) => {
            const score = (u) => {
                if (u.includes(".mp4")) return 0;
                if (u.includes("strcloud")) return 1;
                if (u.includes("justplay")) return 2;
                return 3;
            };
            return score(a) - score(b);
        });

        for (const embedUrl of embedCandidates) {
            const resolved = await resolveEmbedStream(embedUrl, episodeUrl);
            if (resolved) {
                return JSON.stringify({
                    streams: [resolved],
                    subtitles: "",
                });
            }
        }

        return JSON.stringify({ streams: [], subtitles: "" });
    } catch (error) {
        console.log("KissAsian extractStreamUrl error: " + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}
