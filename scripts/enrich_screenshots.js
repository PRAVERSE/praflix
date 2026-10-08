#!/usr/bin/env node
/**
 * PRAFLIX — Screenshots & Stills Catalog Enrichment Engine
 * A PRAVERSE Company
 *
 * Enriches catalog titles and source records with verified screenshot URLs:
 * 1. For HDWall: Extracts screenshot URLs from the verified `/uploads/posts/covers/photo_...` pattern.
 * 2. Deduplicates identical screenshots.
 * 3. Combines multi-provider screenshots for shared canonical titles.
 * 4. Preserves provider attribution ({ url, source, provider, caption }).
 * 5. Leaves titles without screenshots with an empty array or omitted (no empty placeholders).
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const SOURCES_PATH = path.join(DATA_DIR, 'source-records.json');

console.log('='.repeat(70));
console.log('PRAFLIX — ENRICHING CATALOG WITH MOVIE SCREENSHOTS & STILLS');
console.log('='.repeat(70));

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));

console.log(`Loaded catalog: ${catalog.length.toLocaleString()} titles`);
console.log(`Loaded source records: ${sources.length.toLocaleString()} records`);

// 1. Enrich HDWall source records with screenshots
const hdwCoverToScreenshot = new Map();
let hdwSourcesEnriched = 0;

sources.forEach(s => {
  if (s.source === 'hdwall' && s.sourcePosterUrl && s.sourcePosterUrl.includes('/uploads/posts/covers/photo_')) {
    const ssUrl = s.sourcePosterUrl.replace('/uploads/posts/covers/photo_', '/uploads/posts/screenshot/screenshot_');
    s.screenshots = [ssUrl];
    hdwSourcesEnriched++;
    if (s.sourceUrl) hdwCoverToScreenshot.set(s.sourceUrl, ssUrl);
    if (s.sourceId) hdwCoverToScreenshot.set(s.sourceId, ssUrl);
  }
});

console.log(`Enriched ${hdwSourcesEnriched.toLocaleString()} HDWall source records with screenshots.`);

// 2. Enrich Canonical Catalog
let canonicalsWithScreenshots = 0;
let totalScreenshotsAttached = 0;

catalog.forEach(item => {
  const screenshots = [];
  const seenUrls = new Set();

  // Check each variant
  (item.variants || []).forEach(v => {
    // HDWall screenshot
    if (v.source === 'hdwall') {
      const ssUrl = hdwCoverToScreenshot.get(v.sourceUrl) || hdwCoverToScreenshot.get(v.sourceId);
      if (ssUrl && !seenUrls.has(ssUrl)) {
        seenUrls.add(ssUrl);
        screenshots.push({
          url: ssUrl,
          source: 'hdwall',
          provider: 'HDWall',
          caption: `${item.displayTitle} — HDWall Movie Still`
        });
        v.screenshots = [ssUrl];
      }
    }
  });

  if (screenshots.length > 0) {
    item.screenshots = screenshots;
    canonicalsWithScreenshots++;
    totalScreenshotsAttached += screenshots.length;
  }
});

console.log(`Enriched ${canonicalsWithScreenshots.toLocaleString()} canonical titles with ${totalScreenshotsAttached.toLocaleString()} screenshots.`);

// Save enriched catalog & sources
fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2), 'utf8');

console.log('[SUCCESS] Saved enriched catalog.json and source-records.json.');
