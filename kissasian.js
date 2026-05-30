const KISSASIAN_ORIGIN = "https://kissasian.cam";
const KISSASIAN_MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

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
    const seen = new Set();
    const patterns = [
        /<iframe[^>]+src=["']([^"']+)["']/gi,
        /<iframe[^>]+data-src=["']([^"']+)["']/gi,
        /<iframe[^>]+data-lazy-src=["']([^"']+)["']/gi,
    ];
    for (const iframeRegex of patterns) {
        let match;
        while ((match = iframeRegex.exec(html)) !== null) {
            const src = resolveMediaUrl(match[1].trim(), KISSASIAN_ORIGIN);
            if (!src || isSkippableEmbed(src) || seen.has(src)) continue;
            seen.add(src);
            sources.push(src);
        }
    }
    return sources;
}

function resolveMediaUrl(url, baseUrl) {
    if (!url) return null;
    let full = String(url).trim().replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    if (!full) return null;
    if (full.startsWith("//")) full = "https:" + full;
    if (full.startsWith("http")) return full;
    if (!baseUrl) return null;
    try {
        return new URL(full, baseUrl).href;
    } catch (e) {
        return null;
    }
}

function inferSubtitleLabel(url, label) {
    if (label && String(label).trim()) {
        const raw = decodeHtmlEntities(String(label).trim());
        const code = raw.toLowerCase();
        const codeMap = {
            eng: "English",
            en: "English",
            english: "English",
            chi: "Chinese",
            zh: "Chinese",
            chinese: "Chinese",
            fre: "French",
            fr: "French",
            ger: "German",
            de: "German",
            ita: "Italian",
            it: "Italian",
            jpn: "Japanese",
            ja: "Japanese",
            kor: "Korean",
            ko: "Korean",
            por: "Portuguese",
            pt: "Portuguese",
            spa: "Spanish",
            es: "Spanish",
        };
        if (codeMap[code]) return codeMap[code];
        if (/english/i.test(raw)) return "English";
        if (/chinese|中文|汉语|华语/i.test(raw)) return "Chinese";
        return raw;
    }
    const u = (url || "").toLowerCase();
    if (/english|eng|en[_-]|[_-]en\.|\/en\//i.test(u)) return "English";
    if (/zh|chinese|中文|汉语|华语|cn[_-]|chi/i.test(u)) return "Chinese";
    return "Subtitle";
}

function parseSubtitleTracksFromNetworkResult(networkResult, baseUrl, requestHeaders) {
    const headers = requestHeaders || {};
    const tracks = [];
    const seen = new Set();

    function ingest(url, label) {
        const full = resolveMediaUrl(url, baseUrl);
        if (!full || seen.has(full)) return;
        const isTextTrack =
            /\.(vtt|srt|ass)(?:\?|$)/i.test(full) ||
            full.includes(".vtt?") ||
            (full.includes(".m3u8") && /subtitle|caption|sub|cc/i.test(full + (label || "")));
        if (!isTextTrack) return;
        seen.add(full);
        tracks.push({
            title: inferSubtitleLabel(full, label),
            url: full,
            headers: { ...headers },
        });
    }

    const requests = (networkResult && networkResult.requests) || [];
    for (const req of requests) {
        if (/\.(vtt|srt|ass)/i.test(req)) ingest(req, null);
    }

    const captured = (networkResult && networkResult.subtitleTracks) || [];
    for (const t of captured) {
        if (t && t.url) ingest(t.url, t.title || t.label);
    }

    if (networkResult && networkResult.html) {
        return mergeSubtitleTracks(tracks, networkResult.html, baseUrl, headers);
    }
    return tracks;
}

function parseM3u8SubtitleTracks(m3u8Text, m3u8Url, requestHeaders) {
    const tracks = [];
    const seen = new Set();
    const headers = requestHeaders || {};
    if (!m3u8Text) return tracks;

    const lines = m3u8Text.split(/\r?\n/);
    for (const line of lines) {
        if (!line.includes("TYPE=SUBTITLES") && !line.includes("TYPE=CLOSED-CAPTIONS")) continue;
        const uriMatch = line.match(/URI="([^"]+)"/i);
        if (!uriMatch) continue;
        const resolved = resolveMediaUrl(uriMatch[1], m3u8Url);
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        const nameMatch = line.match(/NAME="([^"]+)"/i);
        const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
        const label = nameMatch ? nameMatch[1] : langMatch ? langMatch[1] : "English";
        tracks.push({
            title: inferSubtitleLabel(resolved, label),
            url: resolved,
            headers: { ...headers },
        });
    }
    return tracks;
}

async function fetchM3u8SubtitleTracks(m3u8Url, requestHeaders) {
    if (!m3u8Url || !m3u8Url.includes(".m3u8")) return [];
    try {
        const response = await fetchv2(m3u8Url, requestHeaders || {}, "GET", null);
        const text = await response.text();
        return parseM3u8SubtitleTracks(text, m3u8Url, requestHeaders);
    } catch (e) {
        console.log("KissAsian m3u8 subtitle parse failed: " + e);
        return [];
    }
}

function parseSubtitleTracks(html, baseUrl, requestHeaders) {
    const tracks = [];
    const seen = new Set();
    const headers = requestHeaders || {};

    function add(url, label) {
        const full = resolveMediaUrl(url, baseUrl);
        if (!full || seen.has(full)) return;
        const isTextTrack =
            /\.(vtt|srt|ass)(?:\?|$)/i.test(full) ||
            full.includes(".vtt?") ||
            (full.includes(".m3u8") && /subtitle|caption|sub|cc/i.test(full + (label || "")));
        if (!isTextTrack) return;
        seen.add(full);
        tracks.push({
            title: inferSubtitleLabel(full, label),
            url: full,
            headers: { ...headers },
        });
    }

    if (!html) return tracks;

    const trackTag =
        /<track[^>]+src=["']([^"']+)["'][^>]*(?:label=["']([^"']*)["'])?/gi;
    let match;
    while ((match = trackTag.exec(html)) !== null) {
        add(match[1], match[2]);
    }

    const filePatterns = [
        /["'](https?:\/\/[^"']+\.(?:vtt|srt|ass)(?:\?[^"']*)?)["']/gi,
        /["'](https?:\\\/\\\/[^"']+\.(?:vtt|srt|ass)(?:\?[^"']*)?)["']/gi,
        /file:\s*["']([^"']+\.(?:vtt|srt|ass)[^"']*)["']/gi,
        /"file"\s*:\s*"([^"]+\.(?:vtt|srt|ass)[^"]*)"[\s,]*(?:"label"\s*:\s*"([^"]*)")?/gi,
        /"label"\s*:\s*"([^"]*)"[\s,]*"file"\s*:\s*"([^"]+\.(?:vtt|srt|ass)[^"]*)"/gi,
        /subtitle[_-]?url["']?\s*[:=]\s*["']([^"']+)["']/gi,
        /caption[_-]?url["']?\s*[:=]\s*["']([^"']+)["']/gi,
        /["']src["']\s*:\s*["']([^"']+\.(?:vtt|srt|ass)[^"']*)["']/gi,
    ];
    for (const pattern of filePatterns) {
        while ((match = pattern.exec(html)) !== null) {
            let url;
            let label;
            if (match[2] && /\.(vtt|srt|ass)/i.test(match[2])) {
                label = match[1];
                url = match[2];
            } else {
                url = (match[1] || match[0]).trim();
                label = match[2];
            }
            add(url, label);
        }
    }

    const jwTrackRegex =
        /\{[^{}]*?["']kind["']\s*:\s*["']captions["'][^{}]*?\}/gi;
    while ((match = jwTrackRegex.exec(html)) !== null) {
        const block = match[0];
        const fileMatch = block.match(/["']file["']\s*:\s*["']([^"']+)["']/i);
        const labelMatch = block.match(/["']label["']\s*:\s*["']([^"']*)["']/i);
        if (fileMatch) add(fileMatch[1], labelMatch ? labelMatch[1] : "English");
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

function mergeSubtitleTracks(existing, html, baseUrl, requestHeaders) {
    const merged = [...(existing || [])];
    const seen = new Set(merged.map((t) => t.url));
    for (const track of parseSubtitleTracks(html, baseUrl, requestHeaders)) {
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

function extractEplistBlock(html) {
    const epcheck = html.match(
        /<div class="bixbox bxcl epcheck">([\s\S]*?)<div class="bixbox"[^>]*>\s*<div class="releases"><h3><span>Comment/i
    );
    if (epcheck) return epcheck[1];
    const eplister = html.match(
        /<div class="eplister">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<script>if\s*\(\s*jQuery\s*\(\s*['"]\.epcheck/i
    );
    if (eplister) return eplister[1];
    const loose = html.match(/<div class="eplister">([\s\S]*?)<\/div>\s*<\/div>/i);
    return loose ? loose[1] : html;
}

function parseEpisodesFromSeriesHtml(html) {
    const episodes = [];
    const seen = new Set();
    const block = extractEplistBlock(html);

    const rowPatterns = [
        /<li[^>]*>[\s\S]*?<a href="(https:\/\/kissasian\.cam\/[^"]+)"[\s\S]*?<div class="epl-num">(\d+|-)/gi,
        /<li[^>]*>[\s\S]*?<a href="(\/[^"]+)"[\s\S]*?<div class="epl-num">(\d+|-)/gi,
    ];
    for (const rowRegex of rowPatterns) {
        let match;
        while ((match = rowRegex.exec(block)) !== null) {
            const href = normalizeEpisodeUrl(match[1].trim());
            if (!href || seen.has(href)) continue;
            const numRaw = match[2].trim();
            const number =
                numRaw === "-" ? 1 : parseInt(numRaw, 10) || parseEpisodeNumberFromHref(href) || 1;
            seen.add(href);
            episodes.push({ href, number });
        }
        if (episodes.length) {
            episodes.sort((a, b) => a.number - b.number);
            return episodes;
        }
    }

    const linkRegex = /href="((?:https:\/\/kissasian\.cam)?\/[^"]+)"/gi;
    while ((match = linkRegex.exec(block)) !== null) {
        const href = normalizeEpisodeUrl(match[1].trim());
        if (!href || seen.has(href)) continue;
        if (href.includes("/series/") && !href.includes("-episode-")) continue;
        const number = parseEpisodeNumberFromHref(href);
        const isMoviePage = !!href.match(/kissasian\.cam\/[^/]+\/?$/i) && !href.includes("-episode-");
        if (number == null && !isMoviePage) continue;
        seen.add(href);
        episodes.push({ href, number: number != null ? number : 1 });
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
            "User-Agent": KISSASIAN_MOBILE_UA,
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

        if (episodes.length === 0 && pageUrl.includes("/series/")) {
            const playHref = inferPlayUrlFromSeriesHtml(pageUrl, html);
            if (playHref) {
                episodes.push({ href: playHref, number: 1 });
            }
        }

        if (episodes.length === 0 && !pageUrl.includes("/series/")) {
            episodes.push({ href: pageUrl, number: 1 });
        }

        let normalized = episodes.map((ep) => ({
            number: ep.number,
            href: normalizeEpisodeUrl(ep.href) || ep.href,
        }));

        normalized = normalized.filter((ep) => {
            const h = (ep.href || "").toLowerCase();
            if (!h.includes("kissasian.cam")) return false;
            if (h.includes("/series/") && !h.includes("-episode-")) return false;
            return true;
        });

        if (normalized.length === 0 && pageUrl.includes("/series/")) {
            const playHref = inferPlayUrlFromSeriesHtml(pageUrl, html);
            if (playHref) {
                normalized.push({
                    href: normalizeEpisodeUrl(playHref) || playHref,
                    number: 1,
                });
            }
        }

        return JSON.stringify(normalized);
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

async function resolveEmbedStream(embedUrl, referer, options) {
    if (isSkippableEmbed(embedUrl)) return null;

    const fast = !options || options.fast !== false;
    const headers = buildEmbedHeaders(embedUrl, referer);

    if (isDirectMediaUrl(embedUrl)) {
        let subtitleTracks = [];
        if (!fast && embedUrl.includes(".m3u8")) {
            subtitleTracks = await fetchM3u8SubtitleTracks(embedUrl, headers);
        }
        if (!fast) {
            try {
                const embedHtml = await fetchHtml(embedUrl);
                subtitleTracks = mergeSubtitleTracks(subtitleTracks, embedHtml, embedUrl, headers);
            } catch (e) {
                console.log("KissAsian direct embed HTML failed: " + e);
            }
        }
        return {
            title: embedUrl.includes(".m3u8") ? "HLS" : "MP4",
            streamUrl: embedUrl,
            headers,
            subtitleTracks,
        };
    }

    const isJustplay = (embedUrl || "").toLowerCase().includes("justplay");
    const networkOptions = fast
        ? {
              timeoutSeconds: isJustplay ? 22 : 16,
              cutoff: ".m3u8",
              headers: { ...headers, "User-Agent": KISSASIAN_MOBILE_UA },
              maxWaitTime: isJustplay ? 16 : 10,
              returnHTML: true,
              returnCookies: true,
              waitForSelectors: isJustplay ? ["video", "iframe", ".plyr", ".jwplayer"] : ["video", "iframe"],
              clickSelectors: isJustplay
                  ? [".vjs-big-play-button", ".plyr__control--overlaid", ".jw-icon-playback", "button.play"]
                  : [],
          }
        : {
              timeoutSeconds: isJustplay ? 38 : 28,
              cutoff: ".m3u8",
              headers: { ...headers, "User-Agent": KISSASIAN_MOBILE_UA },
              maxWaitTime: isJustplay ? 24 : 18,
              returnHTML: true,
              returnCookies: true,
              waitForSelectors: isJustplay ? ["video", "iframe", ".plyr", ".jwplayer"] : ["video", "iframe"],
              clickSelectors: isJustplay
                  ? [".vjs-big-play-button", ".plyr__control--overlaid", ".jw-icon-playback", "button.play"]
                  : [],
          };

    let streams = await networkFetch(embedUrl, networkOptions);

    if (!streams.requests || streams.requests.length === 0) {
        const mp4Options = { ...networkOptions, cutoff: ".mp4", maxWaitTime: fast ? 6 : networkOptions.maxWaitTime };
        streams = await networkFetch(embedUrl, mp4Options);
    }

    let streamUrl = null;
    if (streams.requests && streams.requests.length > 0) {
        streamUrl =
            streams.requests.find((u) => u.includes(".m3u8")) ||
            streams.requests.find((u) => u.includes(".mp4")) ||
            streams.requests[0];
    }

    let embedSubtitleTracks = parseSubtitleTracksFromNetworkResult(streams, embedUrl, headers);
    if (!fast) {
        try {
            const embedHtml = streams.html || (await fetchHtml(embedUrl));
            embedSubtitleTracks = mergeSubtitleTracks(embedSubtitleTracks, embedHtml, embedUrl, headers);
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
    } else if (!streamUrl && streams.html) {
        const parsed = parseMediaUrlsFromHtml(streams.html);
        streamUrl =
            parsed.find((u) => u.includes(".m3u8")) ||
            parsed.find((u) => u.includes(".mp4")) ||
            parsed[0];
    }

    if (!streamUrl) return null;

    if (!fast && streamUrl.includes(".m3u8")) {
        const m3u8Subs = await fetchM3u8SubtitleTracks(streamUrl, headers);
        embedSubtitleTracks = mergeSubtitleTrackLists(embedSubtitleTracks, m3u8Subs);
    }

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

function labelFromSlug(slug) {
    if (!slug) return "All";
    return decodeHtmlEntities(String(slug))
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildSeriesListQuery(filters) {
    const parts = [];
    const search = (filters.search || "").trim();
    if (search) parts.push("s=" + encodeURIComponent(search));
    const status = (filters.status || "").trim();
    if (status) parts.push("status=" + encodeURIComponent(status));
    const type = (filters.type || "").trim();
    if (type) parts.push("type=" + encodeURIComponent(type));
    const order = (filters.order || "").trim();
    if (order) parts.push("order=" + encodeURIComponent(order));
    const genres = filters.genres || filters.genre || [];
    const genreList = Array.isArray(genres) ? genres : [genres].filter(Boolean);
    for (const g of genreList) {
        parts.push("genre[]=" + encodeURIComponent(g));
    }
    const countries = filters.countries || filters.country || [];
    const countryList = Array.isArray(countries) ? countries : [countries].filter(Boolean);
    for (const c of countryList) {
        parts.push("country[]=" + encodeURIComponent(c));
    }
    return parts.length ? "?" + parts.join("&") : "";
}

function isSeriesArchiveHref(href) {
    if (!href || !href.includes("/series/")) return false;
    if (/\/series\/(?:page|feed|list-mode)(?:\/|$)/i.test(href)) return false;
    const slug = (href.match(/\/series\/([^/?#]+)/i) || [])[1] || "";
    return slug.length > 0;
}

function parseSeriesArchiveCards(html, limit) {
    const results = [];
    const seen = new Set();
    const articleRegex = /<article[^>]*class="[^"]*\bbs\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    let articleMatch;
    while ((articleMatch = articleRegex.exec(html)) !== null) {
        const block = articleMatch[1];
        const linkMatch =
            block.match(
                /<a[^>]+href="(https:\/\/kissasian\.cam\/series\/[^"]+)"[^>]*(?:title="([^"]*)")?/i
            ) ||
            block.match(
                /<a[^>]+href="(\/series\/[^"]+)"[^>]*(?:title="([^"]*)")?/i
            );
        if (!linkMatch) continue;

        let rawHref = linkMatch[1].trim();
        if (rawHref.startsWith("/")) rawHref = `${KISSASIAN_ORIGIN}${rawHref}`;
        const href = normalizeSeriesHref(rawHref);
        if (!isSeriesArchiveHref(href)) continue;

        const headline = block.match(/<h2[^>]*>([^<]*)</i);
        const tt = block.match(/<div class="tt[^"]*">\s*([^<]+)/i);
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

        const statusMatch = block.match(/<div class="status\s+[^"]*">([^<]*)</i);
        const typeMatch = block.match(/<div class="typez\s+[^"]*">([^<]*)</i);

        if (!seriesTitle || seen.has(href)) continue;
        seen.add(href);
        results.push({
            title: seriesTitle,
            href,
            image,
            status: statusMatch ? statusMatch[1].trim() : "",
            type: typeMatch ? typeMatch[1].trim() : "",
        });
        if (limit && results.length >= limit) break;
    }

    if (!results.length) {
        for (const item of parseBsArticles(html, limit || 80)) {
            if (!isSeriesArchiveHref(item.href) || seen.has(item.href)) continue;
            seen.add(item.href);
            results.push({
                title: item.title,
                href: item.href,
                image: item.image || "",
                status: "",
                type: "",
            });
            if (limit && results.length >= limit) break;
        }
    }
    return results;
}

async function seriesListFilterOptions() {
    const genres = [
        "action", "adventure", "animation", "biography", "business", "comedy", "crime",
        "crossdressing", "detective", "disaster", "documentary", "drama", "family", "fantasy",
        "food", "friendship", "game-show", "historical", "history", "horror", "investigation",
        "law", "life", "love-polygon", "martial-arts", "mature", "medical", "melodrama",
        "military", "music", "mystery", "political", "psychological", "reality-show",
        "reality-tv", "romance", "school", "sci-fi", "science-fiction", "sitcom", "sport",
        "sports", "supernatural", "suspense", "thriller", "tokusatsu", "tragedy",
        "variety-show", "war", "wuxia", "youth",
    ];
    const countries = [
        "canada", "china", "hong-kong", "india", "japan", "korea", "pakistan", "philippines",
        "south-korea", "taiwan", "thailand", "united-states", "usa", "vietnam",
    ];
    return JSON.stringify({
        genres: genres.map((value) => ({ value, label: labelFromSlug(value) })),
        countries: countries.map((value) => ({ value, label: labelFromSlug(value) })),
        statuses: [
            { value: "", label: "All" },
            { value: "ongoing", label: "Ongoing" },
            { value: "completed", label: "Completed" },
            { value: "upcoming", label: "Upcoming" },
        ],
        types: [
            { value: "", label: "All" },
            { value: "drama", label: "Drama" },
            { value: "tv show", label: "TV Show" },
            { value: "anime", label: "Anime" },
            { value: "movie", label: "Movie" },
            { value: "special", label: "Special" },
        ],
        orders: [
            { value: "", label: "Default" },
            { value: "update", label: "Latest Update" },
            { value: "latest", label: "Latest Added" },
            { value: "popular", label: "Popular" },
            { value: "rating", label: "Rating" },
            { value: "title", label: "A–Z" },
            { value: "titlereverse", label: "Z–A" },
        ],
    });
}

async function seriesList(filtersJson, page) {
    try {
        const filters =
            typeof filtersJson === "string"
                ? JSON.parse(filtersJson || "{}")
                : filtersJson || {};
        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const query = buildSeriesListQuery(filters);
        const base =
            pageNum <= 1
                ? `${KISSASIAN_ORIGIN}/series/`
                : `${KISSASIAN_ORIGIN}/series/page/${pageNum}/`;
        const url = `${base}${query}`;
        const html = await fetchHtml(url);
        let items = parseSeriesArchiveCards(html);
        if (!items.length && pageNum === 1 && !query) {
            const homeHtml = await fetchHtml(`${KISSASIAN_ORIGIN}/`);
            items = parseBsArticles(homeHtml, 60).filter((item) => isSeriesArchiveHref(item.href));
        }
        const nextPath = `/series/page/${pageNum + 1}/`;
        const hasNextPage =
            items.length > 0 &&
            (html.includes(nextPath) || html.includes(`series/page/${pageNum + 1}/`));
        return JSON.stringify({ items, page: pageNum, hasNextPage });
    } catch (error) {
        console.log("KissAsian seriesList error: " + error);
        return JSON.stringify({ items: [], page: 1, hasNextPage: false, error: String(error) });
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

/** Maps `/series/slug/` pages to the first episode link or direct `/{slug}/` movie page. */
function inferPlayUrlFromSeriesHtml(pageUrl, html) {
    const episodes = parseEpisodesFromSeriesHtml(html);
    if (episodes.length) {
        return canonicalEpisodePageUrl(episodes[0].href);
    }
    const slug = seriesSlugFromUrl(pageUrl);
    if (!slug) return null;
    return `${KISSASIAN_ORIGIN}/${slug}/`;
}

function embedPriority(embedUrl) {
    const u = (embedUrl || "").toLowerCase();
    if (u.includes("justplay")) return 0;
    if (u.includes("vidmoly") || u.includes("mixdrop") || u.includes("mxdrop")) return 1;
    if (u.includes("dood") || u.includes("highload")) return 2;
    if (u.includes("strcloud")) return 3;
    return 4;
}

/** Try embeds in priority order; fast scrape first, then full scrape if needed. */
async function captureStreamFromEpisodePage(pageUrl, referer) {
    const headers = {
        Referer: referer || `${KISSASIAN_ORIGIN}/`,
        "User-Agent": KISSASIAN_MOBILE_UA,
    };
    const baseOpts = {
        timeoutSeconds: 20,
        headers,
        maxWaitTime: 14,
        returnHTML: true,
        returnCookies: true,
        waitForSelectors: ["iframe", "video", ".iframe-class"],
        clickSelectors: [],
    };
    for (const cutoff of [".m3u8", ".mp4"]) {
        try {
            const cap = await networkFetch(pageUrl, { ...baseOpts, cutoff });
            const requests = cap.requests || [];
            const streamUrl =
                requests.find((u) => u.includes(cutoff)) ||
                requests.find((u) => u.includes(".m3u8")) ||
                requests.find((u) => u.includes(".mp4")) ||
                requests[0];
            if (streamUrl) {
                const subtitleTracks = parseSubtitleTracksFromNetworkResult(cap, pageUrl, headers);
                return { streamUrl, headers, subtitleTracks };
            }
        } catch (e) {
            console.log("KissAsian page network capture failed: " + e);
        }
    }
    return null;
}

async function resolveFirstEmbed(embedUrls, referer) {
    const urls = [...embedUrls].sort((a, b) => embedPriority(a) - embedPriority(b)).slice(0, 4);
    for (const embedUrl of urls) {
        try {
            let resolved = await resolveEmbedStream(embedUrl, referer, { fast: true });
            if (!resolved || !resolved.streamUrl) {
                resolved = await resolveEmbedStream(embedUrl, referer, { fast: false });
            }
            if (resolved && resolved.streamUrl) {
                return [{ embedUrl, resolved }];
            }
        } catch (e) {
            console.log("KissAsian embed failed " + embedUrl + ": " + e);
        }
    }
    return [];
}

/** Resolve up to `maxResults` embeds (used when multiple servers are needed). */
async function resolveEmbedsParallel(embedUrls, referer, maxResults) {
    const cap = maxResults || 1;
    if (cap <= 1) {
        return resolveFirstEmbed(embedUrls, referer);
    }
    const urls = [...embedUrls].sort((a, b) => embedPriority(a) - embedPriority(b)).slice(0, 8);
    const results = [];

    for (let i = 0; i < urls.length && results.length < cap; i += 1) {
        const embedUrl = urls[i];
        try {
            let resolved = await resolveEmbedStream(embedUrl, referer, { fast: true });
            if (!resolved || !resolved.streamUrl) {
                resolved = await resolveEmbedStream(embedUrl, referer, { fast: false });
            }
            if (resolved) results.push({ embedUrl, resolved });
            if (results.length >= cap) break;
        } catch (e) {
            continue;
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
                } else {
                    const playHref = inferPlayUrlFromSeriesHtml(episodeUrl, html);
                    if (playHref && playHref !== episodeUrl) {
                        episodeUrl = canonicalEpisodePageUrl(playHref);
                        html = await fetchHtml(episodeUrl);
                    }
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

        async function tryResolveFromPage(pageUrl, maxServers) {
            let pageHtml = "";
            try {
                pageHtml = await fetchHtml(pageUrl);
            } catch (e) {
                console.log("KissAsian page fetch failed " + pageUrl + ": " + e);
                return;
            }

            subtitleTracks = mergeSubtitleTracks(subtitleTracks, pageHtml, pageUrl, {
                Referer: playReferer,
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            });

            const iframes = parseIframeSources(pageHtml);
            if (!iframes.length) {
                const direct = parseMediaUrlsFromHtml(pageHtml);
                const directUrl =
                    direct.find((u) => u.includes(".m3u8")) ||
                    direct.find((u) => u.includes(".mp4")) ||
                    direct[0];
                if (directUrl) {
                    serverIndex += 1;
                    streams.push({
                        title: `Server ${serverIndex} (direct)`,
                        streamUrl: directUrl,
                        headers: {
                            Referer: playReferer,
                            "User-Agent": KISSASIAN_MOBILE_UA,
                        },
                    });
                }
                return;
            }

            const resolvedList = await resolveEmbedsParallel(iframes, playReferer, maxServers);

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

        for (const pageUrl of pagesToTry.slice(0, 2)) {
            if (streams.length >= 1) break;
            await tryResolveFromPage(pageUrl, 1);
        }

        if (!streams.length) {
            for (const pageUrl of pagesToTry.slice(0, 2)) {
                if (streams.length >= 1) break;
                const captured = await captureStreamFromEpisodePage(pageUrl, playReferer);
                if (captured && captured.streamUrl) {
                    serverIndex += 1;
                    if (captured.subtitleTracks && captured.subtitleTracks.length) {
                        subtitleTracks = mergeSubtitleTrackLists(
                            subtitleTracks,
                            captured.subtitleTracks
                        );
                    }
                    streams.push({
                        title: `Server ${serverIndex} (auto)`,
                        streamUrl: captured.streamUrl,
                        headers: captured.headers,
                    });
                    break;
                }
                await tryResolveFromPage(pageUrl, 2);
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
        const primarySubtitleHeaders = englishSub ? englishSub.headers || {} : {};

        return JSON.stringify({
            streams,
            subtitles: primarySubtitle,
            subtitleHeaders: primarySubtitleHeaders,
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
    g.seriesList = seriesList;
    g.seriesListFilterOptions = seriesListFilterOptions;
})(typeof globalThis !== "undefined" ? globalThis : this);
