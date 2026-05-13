const https = require("https");
const fs = require("fs");
const path = require("path");

const EMAIL = "kehoe@keyninestudios.com";
const TOKEN = "m6uxrAGXB51rkcGZRSwat00jgPh3iMRwICHNE3Um";
const SUBDOMAIN = "keyninestudios";
const AUTH = Buffer.from(`${EMAIL}/token:${TOKEN}`).toString("base64");

const SECTION_MAP = {
  50093011457171: "topten/guides",
  50093225693203: "topten/guides",
  50093212037011: "topten/premium",
  50093195439507: "topten/changelog",
  50136783615635: "topten/misc",
};

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractYoutubeId(src) {
  const patterns = [
    /embed\/([a-zA-Z0-9_-]+)/,
    /youtu\.be\/([a-zA-Z0-9_-]+)/,
    /watch\?v=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = src.match(p);
    if (m) return m[1];
  }
  return null;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function htmlToMdx(html) {
  // 1. YouTube iframes — use[\s\S]*? to match across the full tag including style attrs
  // Zendesk format: <iframe src="//www.youtube-nocookie.com/embed/ID" ...></iframe>
  html = html.replace(/<iframe\s[^>]*?src=["'](.*?)["'][^>]*?>\s*<\/iframe>/gis, (match, src) => {
    src = src.replace(/^\/\//, "https://");
    const ytId = extractYoutubeId(src);
    if (ytId) {
      return `\n<iframe width="100%" style={{aspectRatio:"16/9"}} src="https://www.youtube.com/embed/${ytId}" frameBorder="0" allowFullScreen />\n`;
    }
    return "";
  });

  // 2. Warning tables (pink background)
  html = html.replace(
    /<td[^>]*?background-color:\s*#F5D5D8[^>]*?>([\s\S]*?)<\/td>/gi,
    (_, content) => `\n<Warning>${stripTags(content).trim()}</Warning>\n`
  );

  // 3. Note tables (yellow background)
  html = html.replace(
    /<td[^>]*?background-color:\s*#FFF0DB[^>]*?>([\s\S]*?)<\/td>/gi,
    (_, content) => `\n<Note>${stripTags(content).trim()}</Note>\n`
  );

  // 4. Strip remaining table/figure wrappers
  html = html.replace(/<\/?figure[^>]*>/gi, "");
  html = html.replace(/<\/?table[^>]*>/gi, "");
  html = html.replace(/<\/?tbody[^>]*>/gi, "");
  html = html.replace(/<\/?thead[^>]*>/gi, "");
  html = html.replace(/<\/?tr[^>]*>/gi, "");
  html = html.replace(/<\/?td[^>]*>/gi, "");
  html = html.replace(/<\/?th[^>]*>/gi, "");

  // 5. Strip data-oembed wrappers
  html = html.replace(/<div[^>]*?data-oembed-url[^>]*?>/gi, "");

  // 6. Headings
  html = html.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n## ${stripTags(t).trim()}\n`);
  html = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n### ${stripTags(t).trim()}\n`);
  html = html.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n#### ${stripTags(t).trim()}\n`);

  // 7. Bold
  html = html.replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**");
  html = html.replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**");

  // 8. Links
  html = html.replace(/<a[^>]*?href="([^"]*)"[^>]*?>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = stripTags(text).trim();
    return t ? `[${t}](${href})` : href;
  });

  // 9. Ordered lists
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let i = 1;
    return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, item) => {
      return `${i++}. ${stripTags(item).trim()}\n`;
    }) + "\n";
  });

  // 10. Unordered lists
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, item) => {
      return `- ${stripTags(item).trim()}\n`;
    }) + "\n";
  });

  // 11. Paragraphs and divs
  html = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
    const text = stripTags(content).trim();
    return text ? `\n${text}\n` : "";
  });
  html = html.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, content) => {
    const text = stripTags(content).trim();
    return text ? `\n${text}\n` : "";
  });

  // 12. Images
  html = html.replace(/<img[^>]*?src="([^"]*)"[^>]*?\/?>/gi, (_, src) => `\n![image](${src})\n`);

  // 13. Strip all remaining tags except our converted iframes
  html = html.replace(/<(?!iframe)[^>]+>/g, "");

  // 14. Decode entities
  html = html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

  // 15. Clean up
  html = html.replace(/\n{4,}/g, "\n\n").trim();

  return html;
}

function fetchAllArticles(page = 1, collected = []) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${SUBDOMAIN}.zendesk.com`,
      path: `/api/v2/help_center/articles.json?page=${page}&per_page=30`,
      headers: { Authorization: `Basic ${AUTH}` },
    };
    https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const json = JSON.parse(data);
        const all = collected.concat(json.articles);
        if (json.next_page) {
          resolve(fetchAllArticles(page + 1, all));
        } else {
          resolve(all);
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  console.log("Fetching articles...");
  const articles = await fetchAllArticles();
  console.log(`Found ${articles.length} articles`);

  const navMap = {};

  for (const article of articles) {
    const folder = SECTION_MAP[article.section_id] || "topten/misc";
    const slug = slugify(article.title);
    const filePath = path.join(folder, `${slug}.mdx`);

    fs.mkdirSync(folder, { recursive: true });

    const mdxContent = `---
title: "${article.title.replace(/"/g, '\\"')}"
description: "Top 10! support article"
---

${htmlToMdx(article.body)}
`;

    fs.writeFileSync(filePath, mdxContent);
    console.log(`✓ ${filePath}`);

    if (!navMap[folder]) navMap[folder] = [];
    navMap[folder].push(`${folder}/${slug}`);
  }

  console.log("\n--- Navigation groups for docs.json ---\n");
  for (const [folder, pages] of Object.entries(navMap)) {
    const groupName = folder
      .split("/")
      .pop()
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    console.log(JSON.stringify({ group: groupName, pages }, null, 2));
  }
}

main().catch(console.error);
