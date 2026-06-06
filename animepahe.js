// Animepahe — NEPAX/Shirox bundled (v1.5.0)
// animepahe.pw + Cloudflare session warm via networkFetch (WKWebView)

const ANIMEPAHE_BASE = "https://animepahe.pw";
const PAHE_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const _paheSession = {
    cookies: {},
    warmed: false,
    warming: null,
};

function paheAbsoluteUrl(pathOrUrl) {
    const s = String(pathOrUrl || "");
    if (s.startsWith("http")) {
        return s.replace(/https?:\/\/animepahe\.com/gi, ANIMEPAHE_BASE);
    }
    if (s.startsWith("/")) return ANIMEPAHE_BASE + s;
    return ANIMEPAHE_BASE + "/" + s;
}

function isBlockedResponse(text) {
    if (!text) return true;
    const t = String(text);
    return (
        t.includes("Just a moment") ||
        t.includes("cf-browser-verification") ||
        t.includes("challenge-platform") ||
        t.includes("ddos-guard/js-challenge") ||
        t.includes("DDoS-Guard") ||
        t.includes("data-ddg-origin")
    );
}

function parseJsonFromBody(text) {
    const t = String(text || "").trim();
    if (!t) throw new Error("Empty Animepahe response");
    if (t.charAt(0) === "{" || t.charAt(0) === "[") return JSON.parse(t);
    const pre = t.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (pre) return JSON.parse(pre[1].trim());
    const json = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (json) return JSON.parse(json[1]);
    throw new Error("Animepahe response is not JSON");
}

function mergePaheCookies(cookies) {
    if (!cookies || typeof cookies !== "object") return;
    const keys = Object.keys(cookies);
    for (let i = 0; i < keys.length; i++) {
        _paheSession.cookies[keys[i]] = cookies[keys[i]];
    }
}

function paheCookieHeader() {
    const parts = [];
    const keys = Object.keys(_paheSession.cookies);
    for (let i = 0; i < keys.length; i++) {
        parts.push(keys[i] + "=" + _paheSession.cookies[keys[i]]);
    }
    return parts.join("; ");
}

function paheDefaultHeaders(extra) {
    const headers = {
        "User-Agent": PAHE_UA,
        Accept: "application/json, text/plain, */*",
        Referer: ANIMEPAHE_BASE + "/",
        Origin: ANIMEPAHE_BASE,
    };
    if (extra) {
        const ek = Object.keys(extra);
        for (let i = 0; i < ek.length; i++) headers[ek[i]] = extra[ek[i]];
    }
    const ck = paheCookieHeader();
    if (ck) headers.Cookie = ck;
    return headers;
}

async function warmPaheSession() {
    if (_paheSession.warmed) return;
    if (_paheSession.warming) return _paheSession.warming;
    _paheSession.warming = (async function () {
        try {
            const result = await networkFetch(ANIMEPAHE_BASE + "/", {
                timeoutSeconds: 25,
                returnHTML: true,
                returnCookies: true,
                maxWaitTime: 14,
                headers: paheDefaultHeaders(),
            });
            mergePaheCookies(result.cookies);
            _paheSession.warmed = true;
        } catch (e) {
            console.log("Animepahe warm session failed: " + e);
        }
    })();
    return _paheSession.warming;
}

async function paheFetchViaWebView(url, headers) {
    const result = await networkFetch(url, {
        timeoutSeconds: 28,
        returnHTML: true,
        returnCookies: true,
        maxWaitTime: 14,
        headers: headers || paheDefaultHeaders(),
    });
    mergePaheCookies(result.cookies);
    return {
        text: async function () {
            return result.html || "";
        },
        _viaWebView: true,
    };
}

async function paheFetch(url, options) {
    options = options || {};
    await warmPaheSession();
    const abs = paheAbsoluteUrl(url);
    const headers = paheDefaultHeaders(options.headers);

    let response;
    try {
        response = await fetchv2(abs, headers, options.method || "GET", options.body || null);
    } catch (e) {
        return paheFetchViaWebView(abs, headers);
    }

    let text = "";
    try {
        text = await response.text();
    } catch (e) {
        return paheFetchViaWebView(abs, headers);
    }

    if (!isBlockedResponse(text)) {
        response.text = async function () {
            return text;
        };
        return response;
    }

    return paheFetchViaWebView(abs, headers);
}

async function paheFetchJson(url) {
    const res = await paheFetch(url);
    const text = await res.text();
    return parseJsonFromBody(text);
}

function normalizeAnimepaheSearchKeyword(keyword) {
    let k = String(keyword || "").trim();
    k = k.replace(/\s+season\s*\d+\s*$/i, "");
    k = k.replace(/\s+s\d+\s*$/i, "");
    k = k.replace(/\s+\d+(?:st|nd|rd|th)\s+season\s*$/i, "");
    for (const sep of [" - ", " – ", " — ", " ~"]) {
        const idx = k.indexOf(sep);
        if (idx > 0) {
            k = k.slice(0, idx).trim();
            break;
        }
    }
    return k || String(keyword || "").trim();
}

function animepaheSearchTokens(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function animepaheRelevanceScore(query, title) {
    const q = animepaheSearchTokens(query);
    const t = animepaheSearchTokens(title);
    if (!q.length || !t.length) return 0;
    const qStr = q.join(" ");
    const tStr = t.join(" ");
    let score = 0;
    if (tStr === qStr) score += 100;
    else if (tStr.includes(qStr) || qStr.includes(tStr)) score += 60;
    for (const w of q) {
        if (t.includes(w)) score += 10;
    }
    return score;
}

function rankAnimepaheSearchResults(keyword, results) {
    if (!Array.isArray(results) || results.length <= 1) return results;
    const query = normalizeAnimepaheSearchKeyword(keyword);
    const scored = results.map((item) => ({
        item: item,
        score: animepaheRelevanceScore(query, item.title),
    }));
    const maxScore = Math.max.apply(
        null,
        scored.map((s) => s.score).concat([0])
    );
    if (maxScore < 20) return results;
    const filtered = scored
        .filter((s) => s.score >= Math.max(20, maxScore - 15))
        .sort((a, b) => b.score - a.score)
        .map((s) => s.item);
    return filtered.length ? filtered : results;
}

function parseAnimeSessionId(url) {
    const match = String(url || "").match(/animepahe\.(?:com|pw)\/anime\/([^/?#]+)/i);
    return match ? match[1] : null;
}

async function searchResults(keyword) {
    try {
        const query = normalizeAnimepaheSearchKeyword(keyword);
        const data = await paheFetchJson(
            ANIMEPAHE_BASE + "/api?m=search&q=" + encodeURIComponent(query)
        );

        let transformedResults = [];
        if (data.data) {
            transformedResults = data.data.map((result) => ({
                title: result.title,
                image: result.poster,
                href: ANIMEPAHE_BASE + "/anime/" + result.session,
            }));
            transformedResults = rankAnimepaheSearchResults(query, transformedResults);
        }
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("searchResults error: " + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const response = await paheFetch(paheAbsoluteUrl(url));
        const html = await response.text();

        const descriptionMatch = html.match(/<div class="anime-synopsis">(.*?)<\/div>/s);
        const description = descriptionMatch
            ? descriptionMatch[1].replace(/<br\s*\/?>/g, "\n").trim()
            : "No description available";

        const japaneseTitleMatch = html.match(/<strong>Japanese:\s*<\/strong>(.*?)<\/p>/);
        const typeMatch = html.match(/<strong>Type:.*?>(.*?)<\/a>/);
        const episodesMatch = html.match(/<strong>Episodes:<\/strong>\s*(\d+)/);
        const statusMatch = html.match(/<strong>Status:.*?>(.*?)<\/a>/);
        const durationMatch = html.match(/<strong>Duration:<\/strong>\s*(.*?)<\/p>/);
        const seasonMatch = html.match(/<strong>Season:.*?>(.*?)<\/a>/);
        const studioMatch = html.match(/<strong>Studio:<\/strong>\s*(.*?)\s*<\/p>/);
        const themeMatch = html.match(/<strong>Theme:<\/strong>\s*<a[^>]*>(.*?)<\/a>/);

        const fields = {
            Japanese: japaneseTitleMatch ? japaneseTitleMatch[1].trim() : null,
            Type: typeMatch ? typeMatch[1].trim() : null,
            Episodes: episodesMatch ? episodesMatch[1].trim() + " episodes" : null,
            Status: statusMatch ? statusMatch[1].trim() : null,
            Duration: durationMatch ? durationMatch[1].trim() : null,
            Season: seasonMatch ? seasonMatch[1].trim() : null,
            Studio: studioMatch ? studioMatch[1].trim() : null,
            Theme: themeMatch ? themeMatch[1].trim() : null,
        };

        const aliases = Object.keys(fields)
            .filter((key) => fields[key] && fields[key] !== "N/A")
            .map((key) => key + ": " + fields[key])
            .join("\n");

        const airedMatch = html.match(/<strong>Aired:<\/strong>\s*([\s\S]*?)<\/p>/);
        const airdate = airedMatch
            ? "Aired: " + airedMatch[1].replace(/\s+/g, " ").trim()
            : "Aired: Unknown";

        return JSON.stringify([{ description: description, aliases: aliases, airdate: airdate }]);
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
        const sessionId = parseAnimeSessionId(url);
        if (!sessionId) throw new Error("Invalid Animepahe URL");

        const firstData = await paheFetchJson(
            ANIMEPAHE_BASE +
                "/api?m=release&id=" +
                sessionId +
                "&sort=episode_asc&page=1"
        );
        const totalPages = Math.min(firstData.last_page || 1, 20);

        const pageRequests = [];
        for (let p = 1; p <= totalPages; p++) {
            pageRequests.push(
                paheFetchJson(
                    ANIMEPAHE_BASE +
                        "/api?m=release&id=" +
                        sessionId +
                        "&sort=episode_asc&page=" +
                        p
                ).catch(function () {
                    return null;
                })
            );
        }

        const allPages = await Promise.all(pageRequests);
        const allEpisodes = [];
        for (const page of allPages) {
            if (page && page.data) allEpisodes.push.apply(allEpisodes, page.data);
        }

        const finalResults = allEpisodes
            .map((ep) => ({
                href: ANIMEPAHE_BASE + "/play/" + sessionId + "/" + ep.session,
                number: ep.episode,
            }))
            .sort((a, b) => a.number - b.number);

        return JSON.stringify(finalResults);
    } catch (error) {
        console.log("extractEpisodes error: " + error);
        return JSON.stringify([]);
    }
}

function pickBestKwikTarget(html, fallbackUrl) {
    const regex =
        /<button[^>]*data-src="([^"]+)"[^>]*data-fansub="([^"]*)"[^>]*data-resolution="([^"]*)"[^>]*data-audio="([^"]*)"[^>]*>/g;
    const candidates = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        const src = match[1];
        const fansub = match[2];
        const resolution = match[3];
        const audio = match[4];
        if (audio && audio !== "jpn") continue;
        const numericRes = parseInt(String(resolution).replace(/\D/g, ""), 10) || 0;
        candidates.push({
            src: src,
            fansub: fansub,
            resolution: resolution,
            numericRes: numericRes,
            title: fansub + " · " + resolution + " · SUB",
        });
    }
    if (candidates.length > 0) {
        candidates.sort((a, b) => b.numericRes - a.numericRes);
        return candidates[0];
    }

    const iframeMatch = html.match(/<iframe[^>]+src="(https?:\/\/[^"]*kwik[^"]+)"/i);
    if (iframeMatch) return { src: iframeMatch[1], title: "Pahe" };

    const hrefMatch = html.match(/href="(https?:\/\/[^"]*kwik[^"]+)"/i);
    if (hrefMatch) return { src: hrefMatch[1], title: "Pahe" };

    return { src: fallbackUrl, title: "Pahe" };
}

async function extractStreamUrl(url) {
    try {
        await warmPaheSession();
        const abs = paheAbsoluteUrl(url);
        let playHtml = "";
        let kwikTarget = { src: abs, title: "Pahe" };

        try {
            const playResponse = await paheFetch(abs);
            playHtml = await playResponse.text();
            kwikTarget = pickBestKwikTarget(playHtml, abs);
        } catch (e) {
            console.log("Animepahe play page fetch failed: " + e);
        }

        const networkOptions = {
            timeoutSeconds: 30,
            cutoff: ".m3u8",
            headers: {
                Cookie: paheCookieHeader() ? paheCookieHeader() + "; aud=jpn" : "aud=jpn",
                Referer: ANIMEPAHE_BASE + "/",
            },
            waitForSelectors: [".click-to-load", "iframe"],
            clickSelectors: [".click-to-load"],
            maxWaitTime: 10,
        };

        let streams = await networkFetch(kwikTarget.src, networkOptions);

        if ((!streams.requests || streams.requests.length === 0) && playHtml) {
            streams = await networkFetchFromHTML(playHtml, networkOptions);
        }

        if ((!streams.requests || streams.requests.length === 0) && kwikTarget.src !== abs) {
            streams = await networkFetch(abs, networkOptions);
        }

        if (streams.requests && streams.requests.length > 0) {
            const raw = streams.requests.find((u) => u.includes(".m3u8")) || "";
            if (!raw) {
                return JSON.stringify({ streams: [], subtitles: "" });
            }
            const streamUrl = raw.replace("/stream/", "/hls/").replace("uwu.m3u8", "owo.m3u8");

            return JSON.stringify({
                streams: [
                    {
                        title: kwikTarget.title || "Pahe",
                        streamUrl: streamUrl,
                        headers: {
                            Referer: "https://kwik.cx/",
                            Origin: "https://kwik.cx",
                        },
                    },
                ],
                subtitles: "",
            });
        }
        return JSON.stringify({ streams: [], subtitles: "" });
    } catch (error) {
        console.log("extractStreamUrl error: " + error);
        return JSON.stringify({ streams: [], subtitles: "", error: String(error) });
    }
}

async function soraFetch(url, options) {
    options = options || {};
    return paheFetch(url, {
        headers: options.headers,
        method: options.method || "GET",
        body: options.body || null,
    });
}

(function (g) {
    if (!g) return;
    g.searchResults = searchResults;
    g.extractDetails = extractDetails;
    g.extractEpisodes = extractEpisodes;
    g.extractStreamUrl = extractStreamUrl;
})(typeof globalThis !== "undefined" ? globalThis : this);
