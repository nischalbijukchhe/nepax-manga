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

function parseSubtitleTracks(html, defaultHeaders) {
    const tracks = [];
    const seen = new Set();
    const headers = defaultHeaders || {};

    function add(url, label) {
        if (!url) return;
        let full = url.trim();
        if (full.startsWith("//")) full = "https:" + full;
        if (!full.startsWith("http")) return;
        if (seen.has(full)) return;
        seen.add(full);
        const title = subtitleLabelFromUrl(full, label);
        tracks.push({ title, url: full, headers });
    }

    const trackTag =
        /<track[^>]+src=["']([^"']+)["'][^>]*(?:label=["']([^"']*)["'])?/gi;
    let match;
    while ((match = trackTag.exec(html)) !== null) {
        add(match[1], match[2]);
    }

    const filePatterns = [
        /["'](https?:\/\/[^"']+\.vtt[^"']*)["']/gi,
        /["'](https?:\/\/[^"']+\.srt[^"']*)["']/gi,
        /file:\s*["']([^"']+\.(?:vtt|srt)[^"']*)["']/gi,
        /"file"\s*:\s*"([^"]+\.(?:vtt|srt)[^"]*)"[\s,]*(?:"label"\s*:\s*"([^"]*)")?/gi,
        /"label"\s*:\s*"([^"]*)"[\s,]*"file"\s*:\s*"([^"]+\.(?:vtt|srt)[^"]*)"/gi,
        /"kind"\s*:\s*"(?:captions|subtitles)"[^}]*"src"\s*:\s*"([^"]+)"/gi,
        /"src"\s*:\s*"([^"]+\.(?:vtt|srt)[^"]*)"[^}]*"label"\s*:\s*"([^"]*)"/gi,
        /"label"\s*:\s*"([^"]*)"[^}]*"src"\s*:\s*"([^"]+\.(?:vtt|srt)[^"]*)"/gi,
    ];
    for (const pattern of filePatterns) {
        while ((match = pattern.exec(html)) !== null) {
            let url;
            let label;
            if (match[2] && /\.(vtt|srt)/i.test(match[2])) {
                label = match[1];
                url = match[2];
            } else if (match[2] && /\.(vtt|srt)/i.test(match[1])) {
                url = match[1];
                label = match[2];
            } else {
                url = (match[1] || match[0]).trim();
                label = match[2];
            }
            add(url, label);
        }
    }

    tracks.sort((a, b) => {
        const score = (t) => {
            const title = (t.title || "").toLowerCase();
            if (title.includes("english") || title === "en" || title === "eng") return 0;
            return 1;
        };
        return score(a) - score(b);
    });

    return tracks;
}

function subtitleLabelFromUrl(url, label) {
    if (label && String(label).trim()) {
        const decoded = decodeHtmlEntities(String(label).trim());
        if (/^eng$/i.test(decoded)) return "English";
        if (/^chi$/i.test(decoded)) return "Chinese";
        return decoded;
    }
    const u = (url || "").toLowerCase();
    if (/english|\beng\b|\ben[\._-]/i.test(u)) return "English";
    if (/chinese|\bchi\b|\bzh\b|中文/i.test(u)) return "Chinese";
    return "Subtitle";
}

function parseSubtitleRequests(requests, headers) {
    const tracks = [];
    const seen = new Set();
    for (const raw of requests || []) {
        const url = (raw || "").trim();
        if (!url || !/\.(vtt|srt)(\?|$)/i.test(url)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        tracks.push({
            title: subtitleLabelFromUrl(url, null),
            url,
            headers: headers || {},
        });
    }
    return tracks;
}

async function resolveSubtitleMediaUri(uri, headers) {
    const u = (uri || "").trim();
    if (!u) return null;
    if (/\.(vtt|srt)(\?|$)/i.test(u)) return u;
    if (!/\.m3u8(\?|$)/i.test(u)) return null;
    try {
        const response = await soraFetch(u, { headers: headers || {} });
        const text = await response.text();
        const base = u.replace(/[^/]+$/, "");
        for (const line of text.split("\n")) {
            const t = line.trim();
            if (!t || t.startsWith("#")) continue;
            if (/\.(vtt|srt)(\?|$)/i.test(t)) {
                return t.startsWith("http") ? t : base + t;
            }
        }
    } catch (e) {
        console.log("KissAsian subtitle playlist resolve failed: " + e);
    }
    return null;
}

async function parseHLSSubtitleTracks(m3u8Url, headers) {
    const tracks = [];
    const seen = new Set();
    if (!m3u8Url || !/\.m3u8(\?|$)/i.test(m3u8Url)) return tracks;
    try {
        const response = await soraFetch(m3u8Url, { headers: headers || {} });
        const text = await response.text();
        const base = m3u8Url.replace(/[^/]+$/, "");

        for (const line of text.split("\n")) {
            if (!line.includes("TYPE=SUBTITLES")) continue;
            const uriMatch = line.match(/URI="([^"]+)"/i);
            if (!uriMatch) continue;
            let uri = uriMatch[1].trim();
            if (!uri.startsWith("http")) uri = base + uri;
            const nameMatch = line.match(/NAME="([^"]+)"/i);
            const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
            const title = nameMatch
                ? decodeHtmlEntities(nameMatch[1])
                : langMatch
                  ? langMatch[1]
                  : "Subtitle";
            const resolved = await resolveSubtitleMediaUri(uri, headers);
            const finalUrl = resolved || (/\.(vtt|srt)(\?|$)/i.test(uri) ? uri : null);
            if (!finalUrl || seen.has(finalUrl)) continue;
            seen.add(finalUrl);
            tracks.push({ title, url: finalUrl, headers: headers || {} });
        }

        for (const line of text.split("\n")) {
            const t = line.trim();
            if (!t || t.startsWith("#")) continue;
            if (!/\.(vtt|srt)(\?|$)/i.test(t)) continue;
            const url = t.startsWith("http") ? t : base + t;
            if (seen.has(url)) continue;
            seen.add(url);
            tracks.push({
                title: subtitleLabelFromUrl(url, null),
                url,
                headers: headers || {},
            });
        }
    } catch (e) {
        console.log("KissAsian HLS subtitle parse failed: " + e);
    }
    return tracks;
}

function mergeSubtitleTracks(existing, html, headers) {
    const merged = [...(existing || [])];
    const seen = new Set(merged.map((t) => t.url));
    for (const track of parseSubtitleTracks(html, headers)) {
        if (!seen.has(track.url)) {
            seen.add(track.url);
            merged.push(track);
        }
    }
    return merged;
}

function mergeSubtitleTrackLists(existing, incoming) {
    const merged = [...(existing || [])];
    const seen = new Set(merged.map((t) => t.url));
    for (const track of incoming || []) {
        if (track && track.url && !seen.has(track.url)) {
            seen.add(track.url);
            merged.push(track);
        }
    }
    return merged;
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

        const results = parseBsArticles(html, 40);
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

function buildEmbedHeaders(embedUrl, referer) {
    const headers = {
        Referer: referer || `${KISSASIAN_ORIGIN}/`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    };
    const host = (() => {
        try {
            return new URL(embedUrl).hostname.toLowerCase();
        } catch (e) {
            return "";
        }
    })();

    if (host.includes("justplay.cam")) {
        headers.Referer = "https://justplay.cam/";
        headers.Origin = "https://justplay.cam";
    } else if (host.includes("vidmoly")) {
        headers.Referer = "https://vidmoly.biz/";
        headers.Origin = "https://vidmoly.biz";
    } else if (host.includes("mxdrop") || host.includes("mixdrop")) {
        headers.Referer = embedUrl;
        headers.Origin = `https://${host}`;
    } else if (host.includes("dood")) {
        headers.Referer = embedUrl;
    } else if (host.includes("strcloud")) {
        headers.Referer = embedUrl;
    } else if (host.includes("highload")) {
        headers.Referer = embedUrl;
    }
    return headers;
}

function parseMediaUrlsFromHtml(html) {
    if (!html) return [];
    const found = [];
    const seen = new Set();
    const patterns = [
        /(https?:\/\/[^\s"'\\<>]+?\.m3u8(?:\?[^\s"'\\<>]*)?)/gi,
        /(https?:\/\/[^\s"'\\<>]+?\.mp4(?:\?[^\s"'\\<>]*)?)/gi,
        /file:\s*["']([^"']+\.m3u8[^"']*)["']/gi,
        /file:\s*["']([^"']+\.mp4[^"']*)["']/gi,
        /source\s+src=["']([^"']+)["']/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const url = (match[1] || match[0]).trim();
            if (!url || seen.has(url) || url.includes("facebook.com")) continue;
            seen.add(url);
            found.push(url);
        }
    }
    return found;
}

async function resolveEmbedStream(embedUrl, referer) {
    if (isSkippableEmbed(embedUrl)) return null;

    const headers = buildEmbedHeaders(embedUrl, referer);

    if (isDirectMediaUrl(embedUrl)) {
        return {
            title: embedUrl.includes(".m3u8") ? "HLS" : "MP4",
            streamUrl: embedUrl,
            headers,
        };
    }

    const networkOptions = {
        timeoutSeconds: 22,
        cutoff: ".m3u8",
        headers,
        maxWaitTime: 12,
    };

    let streams = await networkFetch(embedUrl, networkOptions);

    if (!streams.requests || streams.requests.length === 0) {
        const mp4Options = { ...networkOptions, cutoff: ".mp4" };
        streams = await networkFetch(embedUrl, mp4Options);
    }

    let streamUrl = null;
    if (streams.requests && streams.requests.length > 0) {
        streamUrl =
            streams.requests.find((u) => u.includes(".m3u8")) ||
            streams.requests.find((u) => u.includes(".mp4")) ||
            streams.requests[0];
    }

    let embedSubtitleTracks = [];
    if (streams.requests && streams.requests.length) {
        embedSubtitleTracks = mergeSubtitleTrackLists(
            embedSubtitleTracks,
            parseSubtitleRequests(streams.requests, headers)
        );
    }

    try {
        const embedHtml = await fetchHtml(embedUrl);
        embedSubtitleTracks = mergeSubtitleTrackLists(
            embedSubtitleTracks,
            parseSubtitleTracks(embedHtml, headers)
        );
        if (!streamUrl) {
            const parsed = parseMediaUrlsFromHtml(embedHtml);
            streamUrl =
                parsed.find((u) => u.includes(".m3u8")) ||
                parsed.find((u) => u.includes(".mp4")) ||
                parsed[0];
            if (!streamUrl && typeof networkFetchFromHTML === "function") {
                const fromHtml = await networkFetchFromHTML(embedHtml, networkOptions);
                if (fromHtml.requests && fromHtml.requests.length > 0) {
                    streamUrl =
                        fromHtml.requests.find((u) => u.includes(".m3u8")) ||
                        fromHtml.requests.find((u) => u.includes(".mp4")) ||
                        fromHtml.requests[0];
                }
            }
        }
    } catch (e) {
        console.log("KissAsian embed HTML parse failed: " + e);
    }

    if (streamUrl && /\.m3u8(\?|$)/i.test(streamUrl)) {
        embedSubtitleTracks = mergeSubtitleTrackLists(
            embedSubtitleTracks,
            await parseHLSSubtitleTracks(streamUrl, headers)
        );
    }

    if (!streamUrl) return null;

    return {
        title: streamUrl.includes(".m3u8") ? "HLS" : "MP4",
        streamUrl,
        headers,
        subtitleTracks: embedSubtitleTracks,
    };
}

function normalizeSeriesHref(href) {
    if (!href) return href;
    const seriesMatch = href.match(/kissasian\.cam\/series\/([^/?#]+)/i);
    if (seriesMatch) return `https://kissasian.cam/series/${seriesMatch[1]}/`;
    const epMatch = href.match(/kissasian\.cam\/([^/?#]+)-episode-\d+/i);
    if (epMatch) return `https://kissasian.cam/series/${epMatch[1]}/`;
    return href;
}

function parseBsArticles(html, limit) {
    const results = [];
    const seen = new Set();
    const articleRegex = /<article[^>]*class="[^"]*\bbs\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    let articleMatch;
    while ((articleMatch = articleRegex.exec(html)) !== null) {
        const block = articleMatch[1];
        const linkMatch = block.match(
            /<a[^>]+href="(https:\/\/kissasian\.cam\/[^"]+)"[^>]*(?:title="([^"]*)")?/i
        );
        if (!linkMatch) continue;

        const href = normalizeSeriesHref(linkMatch[1].trim());
        const headline = block.match(/<h2[^>]*>([^<]*)</i);
        const tt = block.match(/<div class="tt">\s*([^<]+)/i);
        let title = decodeHtmlEntities(
            (linkMatch[2] || "").trim() ||
                (headline ? headline[1] : "") ||
                (tt ? tt[1] : "")
        )
            .replace(/\s+/g, " ")
            .trim();
        const seriesTitle = title.replace(/\s+Episode\s*\d+.*$/i, "").trim();
        const imgMatch =
            block.match(/<img[^>]+(?:src|data-src)="([^"]+)"[^>]*itemprop="image"/i) ||
            block.match(/<img[^>]+(?:src|data-src)="([^"]+)"/i);
        let image = imgMatch ? imgMatch[1].trim() : "";
        if (image.startsWith("//")) image = "https:" + image;

        if (!href || !title || seen.has(href)) continue;
        seen.add(href);
        results.push({ title: seriesTitle || title, href, image });
        if (limit && results.length >= limit) break;
    }
    return results;
}

function parseSeriesCards(html, limit) {
    return parseBsArticles(html, limit);
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

function enrichImagesFromLatest(items, latestItems) {
    const imageByHref = {};
    for (const item of latestItems || []) {
        if (item.href && item.image) imageByHref[item.href] = item.image;
    }
    return items.map((item) => ({
        ...item,
        image: item.image || imageByHref[item.href] || "",
    }));
}

function parseOngoingCards(html, limit) {
    const results = [];
    const seen = new Set();

    const blockMatch = html.match(/class=['"]ongoingseries['"][^>]*>([\s\S]*?)<\/ul>/i);
    const block = blockMatch ? blockMatch[1] : html;

    const rowRegex =
        /<a[^>]+href="(https:\/\/kissasian\.cam\/[^"]+-episode-\d+[^"]*)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = rowRegex.exec(block)) !== null) {
        const href = normalizeSeriesHref(match[1].trim());
        const titleAttr = decodeHtmlEntities(match[2].trim());
        const inner = match[3] || "";
        const spanL = inner.match(/<span class="l"[^>]*>([\s\S]*?)<\/span>/i);
        let title = spanL
            ? decodeHtmlEntities(spanL[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
            : titleAttr.replace(/\s+Episode\s*\d+.*$/i, "").trim();
        if (!title) title = titleAttr.replace(/\s+Episode\s*\d+.*$/i, "").trim();
        if (!href || !title || seen.has(href)) continue;
        seen.add(href);
        results.push({ title, href, image: "" });
        if (limit && results.length >= limit) break;
    }

    if (results.length) return results;

    const fallback =
        /<a href="(https:\/\/kissasian\.cam\/[^"]+-episode-\d+[^"]*)"[^>]*title="([^"]+)"/gi;
    while ((match = fallback.exec(html)) !== null) {
        const href = normalizeSeriesHref(match[1].trim());
        const title = decodeHtmlEntities(match[2].trim())
            .replace(/\s+Episode\s*\d+.*$/i, "")
            .trim();
        if (!href || !title || seen.has(href)) continue;
        seen.add(href);
        results.push({ title, href, image: "" });
        if (limit && results.length >= limit) break;
    }
    return results;
}

async function fetchGenreSection(genre) {
    try {
        const html = await fetchHtml(`${KISSASIAN_ORIGIN}${genre.path}`);
        const items = parseSeriesCards(html, 14);
        if (!items.length) return null;
        return { id: genre.id, title: genre.title, items };
    } catch (e) {
        console.log("KissAsian browse genre failed " + genre.id + ": " + e);
        return null;
    }
}

async function browseSections() {
    try {
        const sections = [];
        const homeHtml = await fetchHtml(`${KISSASIAN_ORIGIN}/`);

        const latest = parseBsArticles(homeHtml, 18);
        if (latest.length) {
            sections.push({ id: "latest", title: "Latest Release", items: latest });
        }

        const popular = parsePopularCards(homeHtml, 18);
        if (popular.length) {
            sections.push({ id: "popular", title: "Popular This Week", items: popular });
        }

        const ongoingRaw = parseOngoingCards(homeHtml, 20);
        const ongoing = enrichImagesFromLatest(ongoingRaw, latest);
        if (ongoing.length) {
            sections.push({ id: "ongoing", title: "Ongoing", items: ongoing });
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

function canonicalEpisodePageUrl(url) {
    const u = normalizeEpisodePageUrl(url);
    if (u.includes("/series/")) return u;
    return u.replace(/\/v\/\d+\/?$/i, "/").replace(/\/?$/, "/");
}

function embedPriority(embedUrl) {
    const u = (embedUrl || "").toLowerCase();
    if (u.includes("justplay")) return 0;
    if (u.includes("vidmoly") || u.includes("mixdrop") || u.includes("mxdrop")) return 1;
    if (u.includes("dood") || u.includes("highload")) return 2;
    if (u.includes("strcloud")) return 3;
    return 4;
}

/** Resolve up to `maxResults` embeds in parallel batches (faster than one-by-one). */
async function resolveEmbedsParallel(embedUrls, referer, maxResults) {
    const cap = maxResults || 3;
    const urls = [...embedUrls].sort((a, b) => embedPriority(a) - embedPriority(b)).slice(0, 8);
    const results = [];

    for (let i = 0; i < urls.length && results.length < cap; i += 3) {
        const batch = urls.slice(i, i + 3);
        const settled = await Promise.all(
            batch.map(async (embedUrl) => {
                try {
                    const resolved = await resolveEmbedStream(embedUrl, referer);
                    return resolved ? { embedUrl, resolved } : null;
                } catch (e) {
                    return null;
                }
            })
        );
        for (const entry of settled) {
            if (entry) results.push(entry);
            if (results.length >= cap) break;
        }
    }
    return results;
}

function orderMirrorPages(paths) {
    const unique = [...new Set(paths)];
    return unique.sort((a, b) => {
        const na = parseInt((a.match(/\/v\/(\d+)\//) || [])[1] || "99", 10);
        const nb = parseInt((b.match(/\/v\/(\d+)\//) || [])[1] || "99", 10);
        const deprioritize = (n) => (n === 1 ? 1 : 0);
        if (deprioritize(na) !== deprioritize(nb)) return deprioritize(na) - deprioritize(nb);
        return na - nb;
    });
}

async function extractStreamUrl(url) {
    try {
        const inputUrl = (url || "").trim();
        let episodeUrl = canonicalEpisodePageUrl(inputUrl);
        let mirrorPages = [];

        try {
            let html = await fetchHtml(episodeUrl);
            if (episodeUrl.includes("/series/")) {
                const eps = parseEpisodesFromSeriesHtml(html);
                const wantNum = parseEpisodeNumberFromHref(inputUrl);
                if (eps.length) {
                    const pick =
                        wantNum != null
                            ? eps.find((e) => e.number === wantNum) || eps[0]
                            : eps[0];
                    episodeUrl = canonicalEpisodePageUrl(pick.href);
                    html = await fetchHtml(episodeUrl);
                }
            }
            mirrorPages = parseMirrorPaths(html, episodeUrl);
        } catch (e) {
            console.log("KissAsian mirror list fetch failed: " + e);
        }

        const pagesToTry = [];
        const seenPage = new Set();
        function addPage(href) {
            const page = canonicalEpisodePageUrl(href);
            if (!page || seenPage.has(page)) return;
            seenPage.add(page);
            pagesToTry.push(page);
        }

        addPage(episodeUrl);
        const mirrors = mirrorPages.length ? orderMirrorPages(mirrorPages) : [];
        for (const mirror of mirrors) addPage(mirror);

        const streams = [];
        const playReferer = canonicalEpisodePageUrl(episodeUrl);
        let subtitleTracks = [];
        const pageHeaders = {
            Referer: playReferer,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        };
        let serverIndex = 0;

        for (const pageUrl of pagesToTry.slice(0, 5)) {
            if (streams.length >= 3) break;

            let html = "";
            try {
                html = await fetchHtml(pageUrl);
            } catch (e) {
                console.log("KissAsian page fetch failed " + pageUrl + ": " + e);
                continue;
            }

            subtitleTracks = mergeSubtitleTracks(subtitleTracks, html, pageHeaders);

            const iframes = parseIframeSources(html);
            if (!iframes.length) continue;

            const resolvedList = await resolveEmbedsParallel(
                iframes,
                playReferer,
                3 - streams.length
            );

            for (const { embedUrl, resolved } of resolvedList) {
                serverIndex += 1;
                if (resolved.subtitleTracks && resolved.subtitleTracks.length) {
                    subtitleTracks = mergeSubtitleTrackLists(
                        subtitleTracks,
                        resolved.subtitleTracks
                    );
                }
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

        streams.sort((a, b) => {
            const score = (s) => {
                const u = (s.streamUrl || "").toLowerCase();
                let v = 0;
                if (u.includes(".m3u8")) v += 30;
                if (u.includes(".mp4")) v += 15;
                if ((s.title || "").toLowerCase().includes("server 1")) v -= 25;
                if ((s.title || "").toLowerCase().includes("server 2")) v += 10;
                if ((s.title || "").toLowerCase().includes("server 3")) v += 10;
                return v;
            };
            return score(b) - score(a);
        });

        const englishSub =
            subtitleTracks.find((t) => /english|^en$|^eng$/i.test((t.title || "").trim())) ||
            subtitleTracks[0];
        const primarySubtitle = englishSub ? englishSub.url : "";

        return JSON.stringify({
            streams,
            subtitles: primarySubtitle,
            allSubtitles: subtitleTracks,
        });
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
