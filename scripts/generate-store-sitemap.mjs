#!/usr/bin/env node
/**
 * Генерация sitemap.xml и robots.txt для deploy-репо витрины (GitHub Pages).
 * Логика slug ?tovar= должна совпадать с store.js (rebuildTovarSlugMaps).
 *
 * Использование: node scripts/generate-store-sitemap.mjs <subdomain> <shop-domain> <outputDir>
 * Пример: node scripts/generate-store-sitemap.mjs luckyart my-3d-print.ru ./deploy-tmp
 *
 * Вызывается из Store Sync и из workflow «Refresh Store Sitemaps» (ежедневно + вручную).
 * Читает Firebase RTDB без ключа (публичные правила на store / storeProducts / storesBySubdomain).
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_DB_BASE =
  'https://d-print-app-3655b-default-rtdb.europe-west1.firebasedatabase.app';

const RU_TO_LAT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function transliterateRuForSlug(str) {
  const s = String(str || '').toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (RU_TO_LAT[ch] !== undefined) {
      out += RU_TO_LAT[ch];
      continue;
    }
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      continue;
    }
    if (/\s/.test(ch) || ch === '-' || ch === '_' || ch === '.') {
      out += '-';
    }
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function slugifyProductName(name) {
  return transliterateRuForSlug(name) || '';
}

function isVisibleProduct(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.inCatalog === false) return false;
  if (p.active === false) return false;
  return true;
}

function productsToArray(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
}

function buildTovarSlugs(products) {
  const usage = {};
  const slugs = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!isVisibleProduct(p)) continue;
    let base = slugifyProductName(p.name);
    if (!base) base = 'tovar';
    usage[base] = (usage[base] || 0) + 1;
    const slug = usage[base] === 1 ? base : `${base}-${usage[base]}`;
    slugs.push(slug);
  }
  return slugs;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main() {
  const sub = (process.argv[2] || '').trim().toLowerCase();
  const domain = (process.argv[3] || '').trim();
  const outDir = (process.argv[4] || '.').trim();

  if (!sub || !domain) {
    console.error(
      'Usage: node generate-store-sitemap.mjs <subdomain> <shop-domain> <outputDir>',
    );
    process.exit(1);
  }

  const baseUrl = `https://${sub}.${domain}`.replace(/\/$/, '');
  const dbBase = (process.env.FIREBASE_DATABASE_URL || DEFAULT_DB_BASE).replace(/\/$/, '');

  let seoNoindex = false;
  let productSlugs = [];

  try {
    const subKey = encodeURIComponent(sub);
    const subData = await fetchJson(`${dbBase}/storesBySubdomain/${subKey}.json`);
    const ownerUid = subData && subData.ownerUid;
    if (ownerUid) {
      const uidEnc = encodeURIComponent(ownerUid);
      const [store, rawProducts] = await Promise.all([
        fetchJson(`${dbBase}/users/${uidEnc}/store.json`).catch(() => null),
        fetchJson(`${dbBase}/users/${uidEnc}/storeProducts.json`).catch(() => null),
      ]);
      if (store && store.seoNoindex === true) seoNoindex = true;
      const arr = productsToArray(rawProducts);
      productSlugs = buildTovarSlugs(arr);
    }
  } catch (e) {
    console.warn('[sitemap] Firebase:', e.message || e);
  }

  const robotsPath = join(outDir, 'robots.txt');
  const sitemapPath = join(outDir, 'sitemap.xml');

  if (seoNoindex) {
    writeFileSync(robotsPath, 'User-agent: *\nDisallow: /\n', 'utf8');
    writeFileSync(
      sitemapPath,
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n',
      'utf8',
    );
    console.log(`[sitemap] ${sub}: seoNoindex — robots Disallow: /, пустой sitemap`);
    return;
  }

  const urls = [`${baseUrl}/`];
  for (const slug of productSlugs) {
    urls.push(`${baseUrl}/?tovar=${encodeURIComponent(slug)}`);
  }

  const urlEntries = urls
    .map(
      (loc) =>
        `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${loc.endsWith('/') ? '1.0' : '0.7'}</priority>\n  </url>`,
    )
    .join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;

  writeFileSync(sitemapPath, sitemap, 'utf8');
  writeFileSync(
    robotsPath,
    `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`,
    'utf8',
  );

  console.log(`[sitemap] ${sub}: ${urls.length} URL → sitemap.xml, robots.txt`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
