# WeebCentral Scraper (.js)

```js
async function searchResults(keyword) {
    try {
        const response = await soraFetch(`https://weebcentral.com/search/data?text=${encodeURIComponent(keyword)}`);
        const json = await response.json();

        const results = [];
        const seen = new Set();

        if (json && Array.isArray(json.data)) {
            for (const item of json.data) {
                const slug = item.slug || '';
                const title = item.title || 'Unknown';
                const image = item.cover || item.image || '';

                const href = `https://weebcentral.com/series/${slug}`;

                if (!seen.has(href)) {
                    seen.add(href);

                    results.push({
                        title,
                        href,
                        image
                    });
                }
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

        let description = 'No description available';

        const descMatch = htmlText.match(/<meta\s+name="description"\s+content="([^"]+)"/i);

        if (descMatch) {
            description = descMatch[1]
                .replace(/&quot;/g, '"')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .trim();
        }

        let aliases = '';
        const aliasMatch = htmlText.match(/Alternative[^<]*<\/span>\s*<span[^>]*>([^<]+)</i);

        if (aliasMatch) {
            aliases = aliasMatch[1].trim();
        }

        const transformedResults = [{
            description,
            aliases,
            airdate: ''
        }];

        return JSON.stringify(transformedResults);
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
        const response = await soraFetch(url);
        const htmlText = await response.text();

        const chapters = [];
        const seen = new Set();

        // Extract chapter links
        const regex = /href="(\/chapters\/[^\"]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/gi;

        let match;

        while ((match = regex.exec(htmlText)) !== null) {
            const href = `https://weebcentral.com${match[1].trim()}`;
            const title = match[2].trim();

            if (!seen.has(href)) {
                seen.add(href);

                chapters.push({
                    href,
                    title
                });
            }
        }

        // oldest -> newest
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
        const response = await soraFetch(url);
        const htmlText = await response.text();

        let content = 'No content found.';

        // Match all chapter images
        const imageRegex = /<img[^>]+src="([^"]+)"[^>]*class="[^"]*reader-image[^"]*"/gi;

        const images = [];
        let match;

        while ((match = imageRegex.exec(htmlText)) !== null) {
            let img = match[1].trim();

            if (img.startsWith('//')) {
                img = 'https:' + img;
            }

            if (!images.includes(img)) {
                images.push(img);
            }
        }

        if (images.length > 0) {
            const htmlBuilder = [];

            for (const img of images) {
                htmlBuilder.push(
                    `<img src="${img}" style="max-width:100%;height:auto;display:block;margin:0 auto;" />`
                );
            }

            content = htmlBuilder.join('<br/>');
        }

        return content;
    } catch (error) {
        console.log('Fetch error in extractText: ' + error);
        return 'Error extracting content.';
    }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        return await fetchv2(
            url,
            {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://weebcentral.com/',
                ...(options.headers || {})
            },
            options.method || 'GET',
            options.body || null
        );
    } catch (e) {
        try {
            return await fetch(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://weebcentral.com/',
                    ...(options.headers || {})
                },
                body: options.body || null
            });
        } catch (error) {
            console.log('soraFetch error: ' + error);
            return null;
        }
    }
}
```

## Notes

* Updated from MangaWorld to WeebCentral.
* Uses WeebCentral search API endpoint.
* Extracts chapters and images directly from WeebCentral HTML.
* Added safer image extraction.
* Added headers to reduce blocking.
* Returns oldest → newest chapters.
* Fully compatible with your existing structure.
