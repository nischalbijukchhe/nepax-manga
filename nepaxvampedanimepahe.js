// // DDOS BYPASS CLASS
// class DdosGuardInterceptor {
//     constructor() {
//         this.errorCodes = [403]; // Blocked by DDoS-Guard
//         this.serverCheck = ["ddos-guard"]; // Server header check
//         this.cookieStore = {}; // In-memory cookie storage
//     }

//     async fetchWithBypass(url, options = {}) {
//         let response = await this.fetchWithCookies(url, options);

//         // If request is successful or not blocked, return response
//         if (!this.errorCodes.includes(response.status) || !this.isDdosGuard(response)) {
//             return response;
//         }

//         console.error("DDoS-Guard detected, attempting to bypass...");

//         // Check if we already have the __ddg2_ cookie
//         if (this.cookieStore["__ddg2_"]) {
//             console.error("Retrying request with existing DDoS-Guard cookie...");
//             return this.fetchWithCookies(url, options);
//         }

//         // Get a new DDoS-Guard cookie
//         const newCookie = await this.getNewCookie(url);
//         if (!newCookie) {
//             console.error("Failed to retrieve DDoS-Guard cookie.");
//             return response;
//         }

//         console.error("New DDoS-Guard cookie acquired, retrying request...");
        
//         return this.fetchWithCookies(url, options);
//     }

//     async fetchWithCookies(url, options) {
//         const cookieHeader = this.getCookieHeader();
//         const headers = { ...options.headers, Cookie: cookieHeader };

//         const response = await soraFetch(url,  headers );

//         // Store any new cookies received
//         const setCookieHeader = response.headers["Set-Cookie"];
//         if (setCookieHeader) {
//             this.storeCookies(setCookieHeader);
//         }

//         return response;
//     }

//     isDdosGuard(response) {
//         const serverHeader = response.headers["Server"];
//         return serverHeader && this.serverCheck.includes(serverHeader.toLowerCase());
//     }

//     storeCookies(setCookieString) {
//         setCookieString.split(";").forEach(cookieStr => {
//             const [key, value] = cookieStr.split("=");
//             this.cookieStore[key.trim()] = value?.trim() || "";
//         });
//     }

//     getCookieHeader() {
//         return Object.entries(this.cookieStore)
//             .map(([key, value]) => `${key}=${value}`)
//             .join("; ");
//     }

//     async getNewCookie(targetUrl) {
//         try {
//             // Fetch the challenge path from DDoS-Guard
//             const wellKnownResponse = await soraFetch("https://check.ddos-guard.net/check.js");
//             const wellKnownText = await wellKnownResponse.text();

//             const wellKnownPath = wellKnownText.split("'")[1];
//             const regex = /^(https?:\/\/[^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
//             var newUrl = targetUrl.replace(regex, (match, baseUrl, pathname, query, fragment) => {
//                 // If pathname exists, replace it; otherwise, just append the newPath
//                 return `${baseUrl}${wellKnownPath}${query || ''}${fragment || ''}`;
//             });
//             // Make a request to the challenge URL
//             const checkResponse = await this.fetchWithCookies(newUrl, {});
//             const setCookieHeader = checkResponse.headers["Set-Cookie"];

//             if (!setCookieHeader) return null;

//             // Store and return the new DDoS-Guard cookie
//             this.storeCookies(setCookieHeader);
//             return this.cookieStore["__ddg2_"];
//         } catch (error) {
//             console.error("Error fetching DDoS-Guard cookies:");
//             console.error(error.message)
//             return null;
//         }
//     }
// }

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
    return String(text || "").toLowerCase()
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
    const scored = results.map(item => ({
        item,
        score: animepaheRelevanceScore(query, item.title)
    }));
    const maxScore = Math.max(...scored.map(s => s.score), 0);
    if (maxScore < 20) return results;
    const filtered = scored
        .filter(s => s.score >= Math.max(20, maxScore - 15))
        .sort((a, b) => b.score - a.score)
        .map(s => s.item);
    return filtered.length ? filtered : results;
}

async function searchResults(keyword) {
    try {
        const query = normalizeAnimepaheSearchKeyword(keyword);
        const encodedKeyword = encodeURIComponent(query);

        const ddosInterceptor = new DdosGuardInterceptor();
        const responseText = await ddosInterceptor.fetchWithBypass(`https://animepahe.com/api?m=search&q=${encodedKeyword}`);
        const data = await responseText.json();

        let transformedResults = [];

        if (data.data) {
            transformedResults = data.data.map(result => {
                return {
                    title: result.title,
                    image: result.poster,
                    href: `https://animepahe.com/anime/${result.session}`
                };
            });
            transformedResults = rankAnimepaheSearchResults(query, transformedResults);
        } else {
            console.log("No data received from Animepahe");
        }

        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("Fetch error in searchResults: " + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const ddosInterceptor = new DdosGuardInterceptor();
        const response = await ddosInterceptor.fetchWithBypass(url);
        const html = await response.text();

        const descriptionMatch = html.match(/<div class="anime-synopsis">(.*?)<\/div>/s);
        const description = descriptionMatch ? descriptionMatch[1].replace(/<br\s*\/?>/g, '\n').trim() : 'No description available';

        const japaneseTitleMatch = html.match(/<strong>Japanese:\s*<\/strong>(.*?)<\/p>/);
        const typeMatch = html.match(/<strong>Type:.*?>(.*?)<\/a>/);
        const episodesMatch = html.match(/<strong>Episodes:<\/strong>\s*(\d+)/);
        const statusMatch = html.match(/<strong>Status:.*?>(.*?)<\/a>/);
        const durationMatch = html.match(/<strong>Duration:<\/strong>\s*(.*?)<\/p>/);
        const seasonMatch = html.match(/<strong>Season:.*?>(.*?)<\/a>/);
        const studioMatch = html.match(/<strong>Studio:<\/strong>\s*(.*?)\s*<\/p>/);
        const themeMatch = html.match(/<strong>Theme:<\/strong>\s*<a[^>]*>(.*?)<\/a>/);

        const fields = {
            Japanese: japaneseTitleMatch?.[1]?.trim(),
            Type: typeMatch?.[1]?.trim(),
            Episodes: episodesMatch ? `${episodesMatch[1].trim()} episodes` : null,
            Status: statusMatch?.[1]?.trim(),
            Duration: durationMatch?.[1]?.trim(),
            Season: seasonMatch?.[1]?.trim(),
            Studio: studioMatch?.[1]?.trim(),
            Theme: themeMatch?.[1]?.trim(),
        };

        const aliases = Object.entries(fields)
            .filter(([, value]) => value && value !== "N/A")
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");


        const airedMatch = html.match(/<strong>Aired:<\/strong>\s*([\s\S]*?)<\/p>/);
        const airdate = airedMatch ? `Aired: ${airedMatch[1].replace(/\s+/g, ' ').trim()}` : 'Aired: Unknown';

        const transformedResults = [{
            description,
            aliases,
            airdate
        }];

        console.log('Details extracted: ' + JSON.stringify(transformedResults));
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        const match = url.match(/https:\/\/animepahe\.com\/anime\/([^\/]+)/);
        const sessionId = match ? match[1] : null;

        // --- Fetch page 1 ---
        const ddosInterceptor = new DdosGuardInterceptor();

        const firstData = await ddosInterceptor.fetchWithBypass(
            `https://animepahe.com/api?m=release&id=${sessionId}&sort=episode_asc&page=1`
        ).then(r => r.json());

        const totalPages = firstData.last_page || 1;

        // --- Build ALL page requests (including page 1 for simplicity) ---
        const pageRequests = [];
        for (let p = 1; p <= totalPages; p++) {
            pageRequests.push(
                ddosInterceptor.fetchWithBypass(`https://animepahe.com/api?m=release&id=${sessionId}&sort=episode_asc&page=${p}`)
                    .then(res => res.json())
                    .catch(() => null)
            );
        }

        // --- Fetch ALL pages in parallel ---
        const allPages = await Promise.all(pageRequests);

        // --- Collect all episodes ---
        const allEpisodes = [];
        for (const page of allPages) {
            if (page?.data) {
                allEpisodes.push(...page.data);
            }
        }

        // --- Transform to final format ---
        const finalResults = allEpisodes
            .map(ep => ({
                href: `https://animepahe.com/play/${sessionId}/${ep.session}`,
                number: ep.episode
            }))
            .sort((a, b) => a.number - b.number);

        return JSON.stringify(finalResults);
    } catch (error) {
        console.log("Fetch error in extractEpisodes:", error);
        return JSON.stringify([]);
    }
}

function pickBestKwikTarget(html, fallbackUrl) {
    const regex = /<button[^>]*data-src="([^"]+)"[^>]*data-fansub="([^"]*)"[^>]*data-resolution="([^"]*)"[^>]*data-audio="([^"]*)"[^>]*>/g;
    const candidates = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        const [, src, fansub, resolution, audio] = match;
        if (audio && audio !== "jpn") continue;
        const numericRes = parseInt(String(resolution).replace(/\D/g, ""), 10) || 0;
        candidates.push({
            src,
            fansub,
            resolution,
            numericRes,
            title: `${fansub} · ${resolution} · SUB`
        });
    }
    if (candidates.length > 0) {
        candidates.sort((a, b) => b.numericRes - a.numericRes);
        return candidates[0];
    }

    const iframeMatch = html.match(/<iframe[^>]+src="(https?:\/\/[^"]*kwik[^"]+)"/i);
    if (iframeMatch) {
        return { src: iframeMatch[1], title: "Pahe" };
    }

    const hrefMatch = html.match(/href="(https?:\/\/[^"]*kwik[^"]+)"/i);
    if (hrefMatch) {
        return { src: hrefMatch[1], title: "Pahe" };
    }

    return { src: fallbackUrl, title: "Pahe" };
}

async function extractStreamUrl(url) {
    try {
        const ddosInterceptor = new DdosGuardInterceptor();
        let playHtml = "";
        let kwikTarget = { src: url, title: "Pahe" };

        try {
            const playResponse = await ddosInterceptor.fetchWithBypass(url);
            playHtml = await playResponse.text();
            kwikTarget = pickBestKwikTarget(playHtml, url);
        } catch (e) {
            console.log("Animepahe play page fetch failed, using direct URL: " + e);
        }

        const networkOptions = {
            timeoutSeconds: 30,
            cutoff: ".m3u8",
            headers: {
                "Cookie": "aud=jpn",
                "Referer": "https://animepahe.com/"
            },
            waitForSelectors: [".click-to-load"],
            clickSelectors: [".click-to-load"],
            maxWaitTime: 8,
        };

        let streams = await networkFetch(kwikTarget.src, networkOptions);

        if ((!streams.requests || streams.requests.length === 0) && playHtml) {
            streams = await networkFetchFromHTML(playHtml, networkOptions);
        }

        if ((!streams.requests || streams.requests.length === 0) && kwikTarget.src !== url) {
            streams = await networkFetch(url, networkOptions);
        }

        console.log("Animepahe streams: " + JSON.stringify(streams));

        if (streams.requests && streams.requests.length > 0) {
            const raw = streams.requests.find(u => u.includes(".m3u8")) || "";
            if (!raw) {
                return JSON.stringify({ streams: [], subtitles: "" });
            }
            const streamUrl = raw
                .replace("/stream/", "/hls/")
                .replace("uwu.m3u8", "owo.m3u8");

            return JSON.stringify({
                streams: [{
                    title: kwikTarget.title || "Pahe",
                    streamUrl,
                    headers: {
                        "Referer": "https://kwik.cx/",
                        "Origin": "https://kwik.cx"
                    },
                }],
                subtitles: ""
            });
        }
        return JSON.stringify({ streams: [], subtitles: "" });
    } catch (error) {
        console.log("Fetch error in extractStreamUrl: " + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}


// async function extractStreamUrl(url) {
//     try {
//         const ddosInterceptor = new DdosGuardInterceptor();
//         const response = await ddosInterceptor.fetchWithBypass(url);
//         const html = await response.text();

//         const regex = /<button[^>]*data-src="([^"]+)"[^>]*data-fansub="([^"]+)"[^>]*data-resolution="([^"]+)"[^>]*data-audio="([^"]+)"[^>]*>/g;

//         const subs = [];
//         let match;

//         while ((match = regex.exec(html)) !== null) {
//             const [, src, fansub, resolution, audio] = match;

//             if (audio !== "jpn") continue; // Only SUB

//             const numericRes = parseInt(resolution.replace("p", "").trim(), 10) || 0;

//             subs.push({
//                 src,
//                 fansub,
//                 resolution,
//                 numericRes,
//                 title: `${fansub} · ${resolution}p · SUB`
//             });
//         }

//         // No SUB streams found
//         if (subs.length === 0) {
//             return JSON.stringify({ streams: [], subtitles: "" });
//         }

//         // Pick the highest resolution SUB
//         const bestSub = subs.sort((a, b) => b.numericRes - a.numericRes)[0];

//         // Fetch the selected SUB
//         const result = await networkFetch(bestSub.src, 7, {}, ".m3u8");

//         let streamUrl = "";
//         if (result?.requests?.length) {
//             const raw = result.requests.find(u => u.includes(".m3u8")) || "";
//             streamUrl = raw
//                 .replace("/stream/", "/hls/")
//                 .replace("uwu.m3u8", "owo.m3u8");
//         }

//         return JSON.stringify({
//             streams: [
//                 {
//                     title: bestSub.title,
//                     streamUrl,
//                     headers: {
//                         Referer: "https://kwik.cx/",
//                         Origin: "https://kwik.cx"
//                     }
//                 }
//             ],
//             subtitles: ""
//         });
//     } catch (error) {
//         console.error("Fetch error in extractStreamUrl: " + error);
//         return null;
//     }
// }

// extractStreamUrl("https://animepahe.com/play/db7e133d-2e33-e246-fb6f-f79e0a518d31/5433fdd730aecc0a16e5b7a7bed8ea37dd7b995030189b116294e6d5ce114b1f");

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? 'GET',
            options.body ?? null,
            true,
            options.encoding ?? 'utf-8'
        );
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}

// Fixed DDOS Bypass
class DdosGuardInterceptor {
    constructor() {
        this.errorCodes = [403]; 
        this.serverCheck = ["ddos-guard"]; 
        this.cookieStore = {}; 
    }

    async fetchWithBypass(url, options = {}) {
        let response = await this.fetchWithCookies(url, options);
        let responseText = null;

        if (this.errorCodes.includes(response.status)) {
            const newCookie = await this.getNewCookie(url);
            if (newCookie || this.cookieStore["__ddg2_"]) {
                return this.fetchWithCookies(url, options);
            }
            return response;
        }

        try {
            responseText = await response.text();
        } catch (e) {
            return response;
        }

        const isBlocked = responseText.includes('ddos-guard/js-challenge') || 
                         responseText.includes('DDoS-Guard') || 
                         responseText.includes('data-ddg-origin');
        
        if (!isBlocked) {
            response.text = async () => responseText;
            return response;
        }

        if (this.cookieStore["__ddg2_"]) {
            return this.fetchWithCookies(url, options);
        }

        const newCookie = await this.getNewCookie(url);
        if (!newCookie) {
            response.text = async () => responseText;
            return response;
        }
        
        return this.fetchWithCookies(url, options);
    }

    async fetchWithCookies(url, options) {
        const cookieHeader = this.getCookieHeader();
        const headers = options.headers || {};
        if (cookieHeader) {
            headers.Cookie = cookieHeader;
        }

        const response = await fetchv2(url, headers);

        try {
            const setCookieHeader = response.headers ? response.headers["Set-Cookie"] || response.headers["set-cookie"] : null;
            if (setCookieHeader) {
                this.storeCookies(setCookieHeader);
            }
        } catch (e) {
        }

        return response;
    }

    isDdosGuard(response) {
        const serverHeader = response.headers["Server"];
        return serverHeader && this.serverCheck.includes(serverHeader.toLowerCase());
    }

    storeCookies(setCookieString) {
        const cookies = Array.isArray(setCookieString) ? setCookieString : [setCookieString];

        cookies.forEach(cookieHeader => {
            const parts = cookieHeader.split(";");
            if (parts.length > 0) {
                const [key, value] = parts[0].split("=");
                if (key) {
                    this.cookieStore[key.trim()] = value?.trim() || "";
                }
            }
        });
    }

    getCookieHeader() {
        return Object.entries(this.cookieStore)
            .map(([key, value]) => `${key}=${value}`)
            .join("; ");
    }

    async getNewCookie(targetUrl) {
        try {
            const wellKnownResponse = await fetchv2("https://check.ddos-guard.net/check.js");
            const wellKnownText = await wellKnownResponse.text();

            const paths = wellKnownText.match(/['"](\/\.well-known\/ddos-guard\/[^'"]+)['"]/g);
            const checkPaths = wellKnownText.match(/['"]https:\/\/check\.ddos-guard\.net\/[^'"]+['"]/g);

            if (!paths || paths.length === 0) {
                return null;
            }

            const localPath = paths[0].replace(/['"]/g, '');

            const match = targetUrl.match(/^(https?:\/\/[^\/]+)/);
            if (!match) {
                return null;
            }
            const baseUrl = match[1];

            const localUrl = `${baseUrl}${localPath}`;

            const localResponse = await fetchv2(localUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Referer': targetUrl
                }
            });

            let setCookie = null;
            try {
                setCookie = localResponse.headers ? localResponse.headers["set-cookie"] || localResponse.headers["Set-Cookie"] : null;
            } catch (e) {
            }
            if (setCookie) {
                this.storeCookies(setCookie);
            }

            if (checkPaths && checkPaths.length > 0) {
                const checkUrl = checkPaths[0].replace(/['"]/g, '');

                const checkResponse = await fetchv2(checkUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        'Referer': targetUrl
                    }
                });

                try {
                    setCookie = checkResponse.headers ? checkResponse.headers["set-cookie"] || checkResponse.headers["Set-Cookie"] : null;
                } catch (e) {
                }
                if (setCookie) {
                    this.storeCookies(setCookie);
                }
            }

            if (this.cookieStore["__ddg2_"]) {
                return this.cookieStore["__ddg2_"];
            }

            return null;
        } catch (error) {
            return null;
        }
    }
}
