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

function parseSubtitleTracks(html) {
    const tracks = [];
    const seen = new Set();

    function add(url, label) {
        if (!url) return;
        let full = url.trim();
        if (full.startsWith("//")) full = "https:" + full;
        if (!full.startsWith("http")) return;
        if (seen.has(full)) return;
        seen.add(full);
        const title = decodeHtmlEntities((label || "English").trim()) || "English";
        tracks.push({ title, url: full, headers: {} });
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
    ];
    for (const pattern of filePatterns) {
        while ((match = pattern.exec(html)) !== null) {
            let url;
            let label;
            if (match[2] && /\.(vtt|srt)/i.test(match[2])) {
                label = match[1];
                url = match[2];
            } else {
                url = (match[1] || match[0]).trim();
                label = match[2];
            }
            if (!label) {
                label = /english|eng/i.test(url) ? "English" : /zh|chinese|中文|汉语|华语/i.test(url) ? "中文; 汉语; 华语" : "Subtitle";
            }
            add(url, label);
        }
    }

    tracks.sort((a, b) => {
        const score = (t) => {
            const title = (t.title || "").toLowerCase();
            if (title.includes("english") || title === "en") return 0;
            return 1;
        };
        return score(a) - score(b);
    });

    return tracks;
}

function mergeSubtitleTracks(existing, html) {
    const merged = [...(existing || [])];
    const seen = new Set(merged.map((t) => t.url));
    for (const track of parseSubtitleTracks(html)) {
        if (!seen.has(track.url)) {
            seen.add(track.url);
            merged.push(track);
        }
    }
    return merged;
}

function mergeSubtitleTrackArrays(existing, incoming) {
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

function subtitleTracksFromRequests(requests) {
    const tracks = [];
    const seen = new Set();
    for (const raw of requests || []) {
        const url = (raw || "").trim();
        if (!/\.(vtt|srt)(\?|$|#)/i.test(url)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        const label = /english|eng/i.test(url)
            ? "English"
            : /zh|chinese|chs|cht|中文|汉语|华语/i.test(url)
            ? "中文; 汉语; 华语"
            : "Subtitle";
        tracks.push({ title: label, url, headers: {} });
    }
    return tracks;
}

function parseEpisodeDownloadSubtitles(html) {
    const tracks = [];
    const seen = new Set();
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = liRegex.exec(html)) !== null) {
        const block = match[1];
        if (!/subtitle/i.test(block)) continue;
        const labelMatch = block.match(/Subtitle\s+([^<]+)/i);
        const hrefMatch = block.match(/<a[^>]+href=["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        const href = hrefMatch[1].trim();
        if (!href || seen.has(href)) continue;
        seen.add(href);
        let label = decodeHtmlEntities((labelMatch ? labelMatch[1] : "English").trim()) || "English";
        label = label.replace(/\s+/g, " ");
        tracks.push({
            title: label,
            url: href,
            headers: {},
            needsResolve: !/\.(vtt|srt)(\?|$)/i.test(href),
        });
    }
    return tracks;
}

async function resolveSubtitleDownloadLink(href, referer) {
    if (!href) return null;
    if (/\.(vtt|srt)(\?|$)/i.test(href)) return href;

    const reqHeaders = {
        Referer: referer || `${KISSASIAN_ORIGIN}/`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    };

    if (typeof networkFetch === "function") {
        try {
            const result = await networkFetch(href, {
                timeoutSeconds: 20,
                headers: reqHeaders,
                maxWaitTime: 10,
                returnHTML: true,
            });
            const requests = result.requests || [];
            const subUrl = requests.find((u) => /\.(vtt|srt)(\?|$|#)/i.test(u));
            if (subUrl) return subUrl;
            const html = result.html || "";
            const parsed = parseSubtitleTracks(html);
            if (parsed.length) return parsed[0].url;
        } catch (e) {
            console.log("KissAsian subtitle networkFetch failed " + href + ": " + e);
        }
    }

    try {
        const res = await soraFetch(href, { headers: reqHeaders });
        const finalUrl = (res && res.url) || href;
        if (/\.(vtt|srt)(\?|$)/i.test(finalUrl)) return finalUrl;
        const text = await res.text();
        const parsed = parseSubtitleTracks(text);
        if (parsed.length) return parsed[0].url;
        const direct = text.match(/https?:\/\/[^"'\s<>]+\.(?:vtt|srt)[^"'\s<>]*/i);
        if (direct) return direct[0];
    } catch (e) {
        console.log("KissAsian subtitle soraFetch failed " + href + ": " + e);
    }
    return null;
}

async function resolveEpisodeDownloadSubtitles(html, referer) {
    const pending = parseEpisodeDownloadSubtitles(html);
    const resolved = [];
    for (const item of pending.slice(0, 4)) {
        const url = item.needsResolve
            ? await resolveSubtitleDownloadLink(item.url, referer)
            : item.url;
        if (url) {
            resolved.push({
                title: item.title,
                url,
                headers: { Referer: referer || `${KISSASIAN_ORIGIN}/` },
            });
        }
    }
    return resolved;
}

async function parseM3u8SubtitleTracks(m3u8Url, headers) {
    const tracks = [];
    try {
        const res = await soraFetch(m3u8Url, { headers: headers || {} });
        const text = await res.text();
        const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
        for (const line of text.split("\n")) {
            if (!line.includes("TYPE=SUBTITLES")) continue;
            const nameMatch = line.match(/NAME="([^"]+)"/i);
            const uriMatch = line.match(/URI="([^"]+)"/i);
            if (!uriMatch) continue;
            let uri = uriMatch[1].trim();
            if (uri.startsWith("//")) uri = "https:" + uri;
            else if (!uri.startsWith("http")) uri = base + uri;
            const title = decodeHtmlEntities((nameMatch ? nameMatch[1] : "English").trim()) || "English";
            tracks.push({ title, url: uri, headers: headers || {} });
        }
    } catch (e) {
        console.log("KissAsian m3u8 subtitle parse failed: " + e);
    }
    return tracks;
}

async function collectEmbedSubtitleTracks(streamUrl, headers, capturedRequests, embedHtml) {
    let tracks = [];
    tracks = mergeSubtitleTrackArrays(tracks, subtitleTracksFromRequests(capturedRequests));
    if (embedHtml) {
        tracks = mergeSubtitleTrackArrays(tracks, parseSubtitleTracks(embedHtml));
    }
    if (streamUrl && streamUrl.includes(".m3u8")) {
        const m3u8Subs = await parseM3u8SubtitleTracks(streamUrl, headers);
        tracks = mergeSubtitleTrackArrays(tracks, m3u8Subs);
    }
    return tracks;
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
        const subtitleTracks = await collectEmbedSubtitleTracks(embedUrl, headers, [], null);
        return {
            title: embedUrl.includes(".m3u8") ? "HLS" : "MP4",
            streamUrl: embedUrl,
            headers,
            subtitleTracks,
        };
    }

    const networkOptions = {
        timeoutSeconds: 22,
        cutoff: ".m3u8",
        headers,
        maxWaitTime: 12,
        returnHTML: true,
    };

    const capturedRequests = [];
    let embedHtml = null;

    let streams = await networkFetch(embedUrl, networkOptions);
    if (streams.requests) capturedRequests.push(...streams.requests);
    if (streams.html) embedHtml = streams.html;

    if (!streams.requests || streams.requests.length === 0) {
        const mp4Options = { ...networkOptions, cutoff: ".mp4" };
        streams = await networkFetch(embedUrl, mp4Options);
        if (streams.requests) capturedRequests.push(...streams.requests);
        if (!embedHtml && streams.html) embedHtml = streams.html;
    }

  try {
        const subFetch = await networkFetch(embedUrl, {
            ...networkOptions,
            cutoff: ".vtt",
            maxWaitTime: 10,
            timeoutSeconds: 18,
        });
        if (subFetch.requests) capturedRequests.push(...subFetch.requests);
        if (!embedHtml && subFetch.html) embedHtml = subFetch.html;
    } catch (e) {
        console.log("KissAsian embed subtitle fetch failed: " + e);
    }

    let streamUrl = null;
    if (streams.requests && streams.requests.length > 0) {
        streamUrl =
            streams.requests.find((u) => u.includes(".m3u8")) ||
            streams.requests.find((u) => u.includes(".mp4")) ||
            streams.requests[0];
    }

    if (!embedHtml) {
        try {
            embedHtml = await fetchHtml(embedUrl);
        } catch (e) {
            console.log("KissAsian embed HTML fetch failed: " + e);
        }
    }

    if (!streamUrl && embedHtml) {
        try {
            const parsed = parseMediaUrlsFromHtml(embedHtml);
            streamUrl =
                parsed.find((u) => u.includes(".m3u8")) ||
                parsed.find((u) => u.includes(".mp4")) ||
                parsed[0];
            if (!streamUrl && typeof networkFetchFromHTML === "function") {
                const fromHtml = await networkFetchFromHTML(embedHtml, networkOptions);
                if (fromHtml.requests && fromHtml.requests.length > 0) {
                    capturedRequests.push(...fromHtml.requests);
                    streamUrl =
                        fromHtml.requests.find((u) => u.includes(".m3u8")) ||
                        fromHtml.requests.find((u) => u.includes(".mp4")) ||
                        fromHtml.requests[0];
                }
            }
        } catch (e) {
            console.log("KissAsian embed HTML parse failed: " + e);
        }
    }

    if (!streamUrl) return null;

    const subtitleTracks = await collectEmbedSubtitleTracks(
        streamUrl,
        headers,
        capturedRequests,
        embedHtml
    );

    return {
        title: streamUrl.includes(".m3u8") ? "HLS" : "MP4",
        streamUrl,
        headers,
        subtitleTracks,
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
        let serverIndex = 0;
        const playReferer = canonicalEpisodePageUrl(episodeUrl);
        let subtitleTracks = [];

        for (const pageUrl of pagesToTry.slice(0, 5)) {
            if (streams.length >= 3) break;

            let html = "";
            try {
                html = await fetchHtml(pageUrl);
            } catch (e) {
                console.log("KissAsian page fetch failed " + pageUrl + ": " + e);
                continue;
            }

            subtitleTracks = mergeSubtitleTracks(subtitleTracks, html);
            const dlSubs = await resolveEpisodeDownloadSubtitles(html, playReferer);
            subtitleTracks = mergeSubtitleTrackArrays(subtitleTracks, dlSubs);

            const iframes = parseIframeSources(html);
            if (!iframes.length) continue;

            const resolvedList = await resolveEmbedsParallel(
                iframes,
                playReferer,
                3 - streams.length
            );

            for (const { embedUrl, resolved } of resolvedList) {
                serverIndex += 1;
                subtitleTracks = mergeSubtitleTrackArrays(
                    subtitleTracks,
                    resolved.subtitleTracks || []
                );
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
            subtitleTracks.find((t) => /english|^en$/i.test((t.title || "").trim())) ||
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
