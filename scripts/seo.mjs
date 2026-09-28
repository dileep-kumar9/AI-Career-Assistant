// Search-engine files for the hosted site, written into dist/ after `vite build`:
//   index.html  landing page: indexable, canonical URL, Open Graph, JSON-LD, Google
//               verification, and a static copy of the landing content for crawlers
//   app.html    every other page (the signed-in app): noindex
//   robots.txt, sitemap.xml
// Site URL: SITE_URL (or VITE_SITE_URL); on Vercel the production domain is used.
// Without a site URL (local builds) the site stays out of search engines.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const landing = JSON.parse(
  fs.readFileSync(path.join(root, "src/content/landing.json"), "utf8"),
);

const env = process.env;
const rawSite =
  env.SITE_URL ||
  env.VITE_SITE_URL ||
  (env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "");
const site = rawSite.trim().replace(/\/+$/, "");
const verification = (
  env.GOOGLE_SITE_VERIFICATION ||
  env.VITE_GOOGLE_SITE_VERIFICATION ||
  ""
).trim();

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const indexFile = path.join(dist, "index.html");
if (!fs.existsSync(indexFile)) {
  console.error("dist/index.html not found: run `npm run build:web` first.");
  process.exit(1);
}
const html = fs.readFileSync(indexFile, "utf8");

// The app itself (sign-in, dashboard, resumes…) is personal: never indexed.
fs.writeFileSync(path.join(dist, "app.html"), html);

if (!site || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site)) {
  if (rawSite)
    console.warn(
      `SITE_URL "${rawSite}" is not an https origin: keeping the site out of search engines.`,
    );
  fs.writeFileSync(
    path.join(dist, "robots.txt"),
    "User-agent: *\nDisallow: /\n",
  );
  console.log("seo: no site URL, robots.txt disallows everything.");
  process.exit(0);
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "AI Career Assistant",
  url: `${site}/`,
  description: landing.description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: landing.features.map((f) => f.title),
};

const head = [
  `<title>${esc(landing.title)}</title>`,
  `<meta name="description" content="${esc(landing.description)}" />`,
  `<meta name="keywords" content="${esc(landing.keywords.join(", "))}" />`,
  `<meta name="robots" content="index, follow" />`,
  `<link rel="canonical" href="${esc(site)}/" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:site_name" content="AI Career Assistant" />`,
  `<meta property="og:title" content="${esc(landing.title)}" />`,
  `<meta property="og:description" content="${esc(landing.description)}" />`,
  `<meta property="og:url" content="${esc(site)}/" />`,
  `<meta name="twitter:card" content="summary" />`,
  `<meta name="twitter:title" content="${esc(landing.title)}" />`,
  `<meta name="twitter:description" content="${esc(landing.description)}" />`,
  verification
    ? `<meta name="google-site-verification" content="${esc(verification)}" />`
    : "",
  // "<" is escaped so the JSON can never close the script element.
  `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
]
  .filter(Boolean)
  .join("\n    ");

// What crawlers read before JavaScript runs; React replaces it on load.
const snapshot = [
  '<main style="max-width:72rem;margin:0 auto;padding:3rem 1rem;font-family:system-ui,sans-serif">',
  `<h1>${esc(landing.headline)}</h1>`,
  `<p>${esc(landing.intro)}</p>`,
  '<p><a href="/login">Sign in to start</a></p>',
  "<ul>",
  ...landing.features.map(
    (f) => `<li><h2>${esc(f.title)}</h2><p>${esc(f.text)}</p></li>`,
  ),
  "</ul>",
  "</main>",
].join("");

let page = html
  .replace(/<title>[\s\S]*?<\/title>\s*/, "")
  .replace(/<meta name="description"[^>]*>\s*/, "")
  .replace(/<!--[^>]*search engines[^>]*-->\s*/, "")
  .replace(/<meta name="robots"[^>]*>\s*/, "")
  .replace("</head>", `    ${head}\n  </head>`);
if (!/<div id="root">[\s\S]*?<\/div>/.test(page))
  throw new Error('dist/index.html has no <div id="root">');
page = page.replace(
  /<div id="root">[\s\S]*?<\/div>/,
  `<div id="root">${snapshot}</div>`,
);
fs.writeFileSync(indexFile, page);

fs.writeFileSync(
  path.join(dist, "robots.txt"),
  // App pages stay crawlable so search engines can see their noindex tag (and the scripts the landing page needs).
  [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${site}/sitemap.xml`,
    "",
  ].join("\n"),
);

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  path.join(dist, "sitemap.xml"),
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${esc(site)}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    "</urlset>",
    "",
  ].join("\n"),
);
console.log(
  `seo: landing page, robots.txt and sitemap.xml written for ${site}${verification ? " (with Google verification)" : ""}.`,
);
