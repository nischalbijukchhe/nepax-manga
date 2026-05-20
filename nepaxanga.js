async function searchresults(keyword) {
    try {
        const response = await soraFetch(
            `https://weebcentral.com/search/data?text=${encodeURIComponent(keyword)}`
        );

        const json = await response.json();

        const results = [];

        if (json && Array.isArray(json.data)) {
            for (const item of json.data) {
                results.push({
                    title: item.title || "Unknown",
                    href: `https://weebcentral.com/series/${item.slug}`,
                    image: item.cover || ""
                });
            }
        }

        return JSON.stringify(results);

    } catch (error) {
        console.log(error);
        return JSON.stringify([]);
    }
}

async function extractdetails(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        let description = "No description";

        const match = html.match(
            /<meta\\s+name=\"description\"\\s+content=\"([^\"]+)\"/i
        );

        if (match) {
            description = match[1];
        }

        return JSON.stringify([{
            description,
            aliases: "",
            airdate: ""
        }]);

    } catch (e) {
        return JSON.stringify([{
            description: "Error",
            aliases: "",
            airdate: ""
        }]);
    }
}

async function extractchapters(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        const chapters = [];

        const regex = /href=\"(\\/chapters\\/[^\\\"]+)\"/g;

        let match;

        while ((match = regex.exec(html)) !== null) {

            const href = "https://weebcentral.com" + match[1];

            chapters.push({
                href,
                title: "Chapter"
            });
        }

        return JSON.stringify(chapters.reverse());

    } catch (e) {
        console.log(e);
        return JSON.stringify([]);
    }
}

async function extracttext(url) {
    try {
        const response = await soraFetch(url);
        const html = await response.text();

        const regex = /<img[^>]+src=\"([^\"]+)\"/g;

        let match;

        const images = [];

        while ((match = regex.exec(html)) !== null) {

            let img = match[1];

            if (img.includes("uploads")) {
                images.push(img);
            }
        }

        return images.map(img =>
            `<img src=\"${img}\" style=\"width:100%\"/>`
        ).join("<br>");

    } catch (e) {
        console.log(e);
        return "Error";
    }
}

async function soraFetch(url, options = {}) {

    try {

        return await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://weebcentral.com/"
            }
        });

    } catch (e) {

        console.log(e);
        return null;
    }
}
