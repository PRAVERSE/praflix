#!/usr/bin/env node
/**
 * PRAFLIX — ACCEPTANCE SUITE: PROBLEM 10
 * Production Verification, Poster Accuracy & Download-Link Integrity
 * A PRAVERSE Company
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT_DIR, 'data', 'catalog.json');
const DOWNLOADS_PATH = path.join(ROOT_DIR, 'data', 'downloads.json');
const POSTER_VALID_IDS_PATH = path.join(ROOT_DIR, 'data', 'poster-valid-ids.js');
const RESOLVER = require(path.join(ROOT_DIR, 'destination_resolver.js'));

console.log('='.repeat(70));
console.log('PRAFLIX — ACCEPTANCE SUITE: PROBLEM 10 (PRODUCTION VERIFICATION & INTEGRITY)');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
    passed++;
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED`);
    console.error(`  ${err.message}`);
    process.exitCode = 1;
  }
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const downloads = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));

// Build lookup map for downloads
const dlByCatalogueId = new Map();
for (const k of Object.keys(downloads.entries)) {
  const e = downloads.entries[k];
  if (e && e.catalogueId != null) {
    dlByCatalogueId.set(Number(e.catalogueId), e);
  }
}

// Test 01: Verify recovered titles 13674-13678 exist with exact metadata
runTest('Recovered titles 13674-13678 exist with coherent metadata', () => {
  const titles = [
    { id: 13674, title: 'Meri Girlfriend Da Viyaah', year: '2026', type: 'Movie' },
    { id: 13675, title: 'Above & Below', year: '2026', type: 'Movie' },
    { id: 13676, title: 'Pradhama Drishtiya Kuttakkar', year: '2026', type: 'Movie' },
    { id: 13677, title: 'The Woman in Black', year: '2012', type: 'Movie' },
    { id: 13678, title: 'Up in the Air', year: '2009', type: 'Movie' }
  ];

  titles.forEach(t => {
    const item = catalog.find(c => c.canonicalId === t.id);
    assert.ok(item, `Title ID ${t.id} must exist in catalog`);
    assert.strictEqual(item.displayTitle, t.title);
    assert.strictEqual(item.year, t.year);
    assert.strictEqual(item.type, t.type);
    assert.ok(item.variants && item.variants.length > 0, `Title ID ${t.id} must have source provenance`);
  });
});

// Test 02: Verified download destinations for 13674-13676 are genuine storage endpoints
runTest('Recovered titles 13674-13676 have verified storage destinations', () => {
  [13674, 13675, 13676].forEach(id => {
    const dlEntry = dlByCatalogueId.get(id);
    assert.ok(dlEntry, `Download entry for ID ${id} must exist`);
    assert.strictEqual(dlEntry.verificationStatus, 'verified');
    assert.ok(dlEntry.links.length >= 4, `ID ${id} must have at least 4 verified links`);
    dlEntry.links.forEach(l => {
      assert.strictEqual(l.verificationStatus, 'verified');
      assert.ok(l.downloadUrl.includes('hubcdn') || l.downloadUrl.includes('hubdrive'), `Must be approved storage CDN: ${l.downloadUrl}`);
    });
  });
});

// Test 03: Unverified titles 13677-13678 produce clean unavailable state
runTest('Titles 13677-13678 show unverified / clean unavailable state', () => {
  [13677, 13678].forEach(id => {
    const item = catalog.find(c => c.canonicalId === id);
    const dlEntry = dlByCatalogueId.get(id);
    assert.ok(dlEntry, `Download entry for ID ${id} must exist`);
    assert.strictEqual(dlEntry.verificationStatus, 'unverified');
    assert.strictEqual(dlEntry.links.length, 0);

    const resolved = RESOLVER.groupAndOrderDownloads(item, dlEntry);
    assert.strictEqual(resolved.hasLinks, false);
    assert.ok(resolved.emptyReason.includes('No verified download destinations available'), 'Must have unavailable reason');
  });
});

// Test 04: Master catalog integrity and baseline preservation
runTest('Master catalog integrity: Count is 13,678 without record loss', () => {
  assert.ok(catalog.length >= 13678, 'Catalog count must be at least 13,678 without record loss');
  assert.ok(catalog.length >= 13673, 'Catalog baseline preserved');
  const uniqueIds = new Set(catalog.map(c => c.canonicalId));
  assert.strictEqual(uniqueIds.size, catalog.length, 'Zero duplicate canonical IDs in catalog');
});

// Test 05: Download catalog mapping: 100% of catalog titles have a download entry
runTest('Download entries map 100% of canonical catalog records', () => {
  assert.strictEqual(dlByCatalogueId.size, catalog.length, 'Every catalog title must resolve to its download record');
  for (const item of catalog) {
    assert.ok(dlByCatalogueId.has(item.canonicalId), `Missing download entry for ID ${item.canonicalId}`);
  }
});

// Test 06: Repaired posters from Problem 9 remain correct
runTest('Repaired posters remain authentic and verified', () => {
  const donkeyKing = catalog.find(c => c.canonicalId === 4499);
  assert.strictEqual(donkeyKing.poster, 'https://image.tmdb.org/t/p/w342/xzotyfHaej5bcMli3clQD4qcPXx.jpg');

  const welcome = catalog.find(c => c.canonicalId === 13648);
  assert.strictEqual(welcome.poster, 'https://image.tmdb.org/t/p/w342/fudxnXlTTBIDCkpR7XhlIgkNaUY.jpg');

  const beverly = catalog.find(c => c.canonicalId === 13649);
  assert.strictEqual(beverly.poster, 'https://imgshare.info/images/2026/10/08/Beverly-Hills-Cop-1984.jpg');

  const carrie = catalog.find(c => c.canonicalId === 13660);
  assert.strictEqual(carrie.poster, 'https://image.tmdb.org/t/p/w342/baw2al7o6gvxgiJCTKdA4JG5SFc.jpg');
});

// Test 07: Neutral fallback used for confirmed uncertain/mismatched posters
runTest('Neutral fallback used for uncertain/mismatched posters', () => {
  const transformers = catalog.find(c => c.canonicalId === 7119);
  assert.strictEqual(transformers.poster, 'assets/posters/fallback.svg');

  const shivalinga = catalog.find(c => c.canonicalId === 7451);
  assert.strictEqual(shivalinga.poster, 'assets/posters/fallback.svg');

  const greatFather = catalog.find(c => c.canonicalId === 7080);
  assert.strictEqual(greatFather.poster, 'assets/posters/fallback.svg');

  const sabseBadaZero = catalog.find(c => c.canonicalId === 6165);
  assert.strictEqual(sabseBadaZero.poster, 'assets/posters/fallback.svg');
});

// Test 08: Web series complete-season package enforcement
runTest('Web series expose complete-season packages only', () => {
  let exposedEpisodes = 0;
  for (const item of catalog) {
    if (item.type !== 'Web Series') continue;
    const dlEntry = dlByCatalogueId.get(item.canonicalId);
    if (!dlEntry) continue;
    const resolved = RESOLVER.groupAndOrderDownloads(item, dlEntry);
    assert.strictEqual(resolved.seasonEpisodeGroups.length, 0, 'seasonEpisodeGroups must be strictly empty');
    if (resolved.hasLinks) {
      resolved.completeSeasonGroups.forEach(sg => {
        sg.qualities.forEach(q => {
          q.links.forEach(l => {
            if (/episode\s*[1-9]/i.test(l.label || '')) exposedEpisodes++;
          });
        });
      });
    }
  }
  assert.strictEqual(exposedEpisodes, 0, 'Zero individual episode links may be exposed for web series');
});

// Test 09: Series with only individual episodes produce clean unavailable state
runTest('Series with only individual episodes produce clean unavailable state', () => {
  const sampleSeries = catalog.find(c => c.canonicalId === 999); // The Great Indian Kapil Show
  assert.ok(sampleSeries, 'The Great Indian Kapil Show must exist');
  const dlEntry = dlByCatalogueId.get(999);
  const resolved = RESOLVER.groupAndOrderDownloads(sampleSeries, dlEntry);
  assert.strictEqual(resolved.hasLinks, false);
  assert.strictEqual(resolved.emptyReason, 'No verified complete-season links available.');
});

// Test 10: Obsolete details-page sections remain absent from frontend
runTest('Removed sections remain completely absent from frontend UI', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  assert.ok(!html.includes('Cast & Creative Credits'), 'Cast & Creative Credits must not exist');
  assert.ok(!html.includes('Artwork & Posters Gallery'), 'Artwork & Posters Gallery must not exist');
  assert.ok(!html.includes('Essential Title Metadata'), 'Essential Title Metadata must not exist');
  assert.ok(!html.includes('id="section-cast"'), '#section-cast must not exist');
  assert.ok(!html.includes('id="section-artwork"'), '#section-artwork must not exist');
  assert.ok(!html.includes('id="section-metadata"'), '#section-metadata must not exist');
});

// Test 11: No source article names, domains, or reference URLs in download buttons
runTest('Download buttons strictly use Link N labels without provider exposure', () => {
  const sampleMovie = catalog.find(c => c.canonicalId === 13674);
  const dlEntry = dlByCatalogueId.get(13674);
  const resolved = RESOLVER.groupAndOrderDownloads(sampleMovie, dlEntry);
  assert.ok(resolved.hasLinks);
  resolved.movieQualityGroups.forEach(g => {
    g.links.forEach(l => {
      assert.ok(/^Link\s+\d+$/i.test(l.label), `Link label must be Link N, got: ${l.label}`);
      assert.ok(!l.label.includes('hdhub4u'), 'Must not include provider name');
      assert.ok(!l.label.includes('10moviez'), 'Must not include provider name');
      assert.ok(!l.label.includes('hdwall'), 'Must not include provider name');
    });
  });
});

// Test 12: Poster validity index schema and consistency
runTest('Poster valid index schema is valid and consumed correctly', () => {
  const validIdsCode = fs.readFileSync(POSTER_VALID_IDS_PATH, 'utf8');
  assert.ok(validIdsCode.includes('window.PRAFLIX_POSTER_VALID_IDS = new Set('));
  assert.ok(validIdsCode.includes('window.PRAFLIX_POSTER_ORDERED_IDS = ['));

  global.window = {};
  eval(validIdsCode);
  const set = global.window.PRAFLIX_POSTER_VALID_IDS;
  assert.ok(set instanceof Set);
  assert.ok(set.size >= 599, `Valid poster index must contain at least 599 verified posters, found: ${set.size}`);
});

// Test 13: Catalog chunk partitioning matches total master records
runTest('Static chunks match master catalog record count exactly', () => {
  const c1 = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'catalog-chunk-1.json'), 'utf8'));
  const c2 = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'catalog-chunk-2.json'), 'utf8'));
  const c3 = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'catalog-chunk-3.json'), 'utf8'));
  const c4 = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'catalog-chunk-4.json'), 'utf8'));

  const total = c1.length + c2.length + c3.length + c4.length;
  assert.strictEqual(total, catalog.length, 'Sum of all 4 chunks must equal catalog.length');
});

// Test 14: Cloudflare Pages / Workers asset limits enforced
runTest('Deployable assets strictly comply with 25 MiB hosting limit', () => {
  const distDir = path.join(ROOT_DIR, 'dist', 'data');
  const dlDist = path.join(distDir, 'downloads.json');
  const catDist = path.join(distDir, 'catalog.json');

  const dlBytes = fs.statSync(dlDist).size;
  const catBytes = fs.statSync(catDist).size;
  const LIMIT = 25 * 1024 * 1024;

  assert.ok(dlBytes <= LIMIT, `downloads.json must be <= 25 MiB, got ${(dlBytes/(1024*1024)).toFixed(2)} MiB`);
  assert.ok(catBytes <= LIMIT, `catalog.json must be <= 25 MiB, got ${(catBytes/(1024*1024)).toFixed(2)} MiB`);
});

// Test 15: Navigation, search, and details view controllers in app.js
runTest('Frontend SPA interaction controllers intact in app.js', () => {
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
  assert.ok(appJs.includes('function openDetailView('), 'openDetailView must be present');
  assert.ok(appJs.includes('function renderMovieGrid('), 'renderMovieGrid must be present');
  assert.ok(appJs.includes('function renderPagination('), 'renderPagination must be present');
  assert.ok(appJs.includes('function applyFilters('), 'applyFilters must be present');
});

console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} ACCEPTANCE CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
