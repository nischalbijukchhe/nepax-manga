async function searchResults(keyword) {
    try {
        const response = await soraFetch(
            'https://weebcentral.com/search/simple?location=main',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `text=${encodeURIComponent(keyword)}`
            }
        );
        const html = await response.text();

        const results = [];
        const regex = /href="(https:\/\/weebcentral\.com\/series\/[^"]+)"[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?line-clamp-2">\s*([^<]+)/g;

        let match;
        const seen = new Set();
        while ((match = regex.exec(html)) !== null) {
            const href = match[1].trim();
            if (!seen.has(href)) {
                seen.add(href);
                results.push({
                    title: decodeHtmlEntities(match[3].trim()),
                    href: href,
                    image: match[2].trim()
                });
            }
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log('Fetch error in searchResults: ' + error);
        return JSON.stringify([{ title: 'Error', image: '', href: '' }]);
    }
}

async function extractDetails(url) {
    try {
        const response = await soraFetch(url);
        const htmlText = await response.text();

        let description = 'No description available.';
        const descMatch = htmlText.match(/<meta name="description" content="([^"]+)"/);
        if (descMatch) {
            description = decodeHtmlEntities(descMatch[1].trim());
        }

        return JSON.stringify([{
            description,
            aliases: '',
            airdate: ''
        }]);
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: '',
            airdate: ''
        }]);
    }
}

async function extractChapters(url) {
    try {
        const seriesIdMatch = url.match(/\/series\/([^/]+)/);
        if (!seriesIdMatch) {
            return JSON.stringify([]);
        }

        const response = await soraFetch(url);
        let htmlText = await response.text();

        if (htmlText.includes('full-chapter-list')) {
            const fullListResponse = await soraFetch(
                `https://weebcentral.com/series/${seriesIdMatch[1]}/full-chapter-list`
            );
            htmlText = await fullListResponse.text();
        }

        const chapters = [];
        const regex = /href="(https:\/\/weebcentral\.com\/chapters\/[^"]+)"[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;

        let match;
        const seen = new Set();
        while ((match = regex.exec(htmlText)) !== null) {
            const href = match[1].trim();
            if (!seen.has(href)) {
                seen.add(href);
                chapters.push({
                    href: href,
                    title: decodeHtmlEntities(match[2].trim())
                });
            }
        }

        chapters.reverse();

        const numberedChapters = chapters.map((ch, i) => ({
            ...ch,
            number: i + 1
        }));

        return JSON.stringify(numberedChapters);
    } catch (error) {
        console.log('Fetch error in extractChapters: ' + error);
        return JSON.stringify([]);
    }
}

async function extractText(url) {
    try {
        const chapterIdMatch = url.match(/\/chapters\/([^/?]+)/);
        if (!chapterIdMatch) {
            return 'Chapter not found.';
        }

        const chapterId = chapterIdMatch[1];
        const imagesUrl = `https://weebcentral.com/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`;

        const response = await soraFetch(imagesUrl, {
            headers: { 'HX-Request': 'true' }
        });
        const htmlText = await response.text();

        const images = [];
        const imgRegex = /src="(https:\/\/[^"]+\.(?:png|jpg|jpeg|webp))"/gi;
        let imgMatch;
        const seenImages = new Set();
        while ((imgMatch = imgRegex.exec(htmlText)) !== null) {
            const src = imgMatch[1].trim();
            if (!seenImages.has(src) && !src.includes('broken_image')) {
                seenImages.add(src);
                images.push(src);
            }
        }

        if (images.length === 0) {
            const pageResponse = await soraFetch(url);
            const pageHtml = await pageResponse.text();
            const maxPageMatch = pageHtml.match(/max_page:\s*parseInt\('(\d+)'\)/);
            const preloadMatch = pageHtml.match(/<link rel="preload" href="(https:\/\/[^"]+\/manga\/[^/]+\/\d+-\d+\.(?:png|jpg|jpeg|webp))"/);

            if (maxPageMatch && preloadMatch) {
                const maxPage = parseInt(maxPageMatch[1], 10);
                const sampleUrl = preloadMatch[1];
                const basePath = sampleUrl.substring(0, sampleUrl.lastIndexOf('/') + 1);
                const fileMatch = sampleUrl.match(/(\d+-\d+)\.(png|jpg|jpeg|webp)$/i);
                if (fileMatch) {
                    const prefix = fileMatch[1].split('-')[0];
                    const ext = fileMatch[2];
                    for (let i = 1; i <= maxPage; i++) {
                        const pageNum = String(i).padStart(3, '0');
                        images.push(`${basePath}${prefix}-${pageNum}.${ext}`);
                    }
                }
            }
        }

        if (images.length === 0) {
            return 'No content found.';
        }

        return images.map(src =>
            `<img src='${src}' style='max-width: 100%; height: auto; display: block; margin: 0 auto;' />`
        ).join('<br/>');
    } catch (error) {
        console.log('Fetch error in extractText: ' + error);
        return 'Error loading chapter content.';
    }
}

function decodeHtmlEntities(text) {
    return text
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}
