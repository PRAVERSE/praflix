/**
 * PRAFLIX — Problem 12 Local Poster Downloader
 * Downloads verified artwork for prominent 2026/2025 titles to assets/posters/
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const POSTERS_DIR = path.join(ROOT_DIR, 'assets', 'posters');
const CATALOG_PATH = path.join(ROOT_DIR, 'data', 'catalog.json');

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

// Find candidate titles from 2026 that have unique confirmed sourcePosterUrl on catimages or imgshare
const confirmedHosts = new Set(['imgshare.info', 'catimages.co', 'catimages.org', 'myimg.click']);

// Compute URL uniqueness
const urlCounts = new Map();
catalog.forEach(c => {
  if (c.sourcePosterUrl) {
    const u = c.sourcePosterUrl.trim();
    urlCounts.set(u, (urlCounts.get(u) || 0) + 1);
  }
});

const candidates = catalog.filter(c => {
  if (c.poster !== 'assets/posters/fallback.svg') return false;
  if (!c.sourcePosterUrl) return false;
  const u = c.sourcePosterUrl.trim();
  if (urlCounts.get(u) !== 1) return false;
  if (c.year !== '2026' && c.year !== '2025') return false;
  try {
    const h = new URL(u).hostname.toLowerCase();
    return confirmedHosts.has(h);
  } catch (_) { return false; }
});

console.log(`Found ${candidates.length} candidate 2026/2025 titles for local poster download.`);

function slugify(title) {
  return String(title || 'poster')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function run() {
  const targetBatch = candidates.slice(0, 60);
  let downloadedCount = 0;
  const downloadedMap = new Map();

  for (const item of targetBatch) {
    const slug = slugify(item.displayTitle) + '-' + item.year;
    const ext = item.sourcePosterUrl.toLowerCase().endsWith('.png') ? '.png' : '.jpg';
    const localFileName = `${slug}${ext}`;
    const localFilePath = path.join(POSTERS_DIR, localFileName);
    const relPath = `assets/posters/${localFileName}`;

    try {
      const res = await fetch(item.sourcePosterUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('image/')) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 500) {
          fs.writeFileSync(localFilePath, buffer);
          downloadedCount++;
          downloadedMap.set(item.canonicalId, relPath);
          console.log(`✓ [${downloadedCount}/60] Saved ${localFileName} (${(buffer.length / 1024).toFixed(1)} KB) for ID ${item.canonicalId}: ${item.displayTitle}`);
        }
      }
    } catch (err) {
      // transient download failure, skip
    }
  }

  console.log(`\nSuccessfully downloaded ${downloadedCount} local poster files to ${POSTERS_DIR}`);
  fs.writeFileSync(
    path.join(ROOT_DIR, 'scratch', 'downloaded_local_posters.json'),
    JSON.stringify(Object.fromEntries(downloadedMap), null, 2),
    'utf8'
  );
}

run();
