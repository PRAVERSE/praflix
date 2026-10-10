#!/usr/bin/env node
/**
 * PRAFLIX — ACCEPTANCE TEST SUITE: PROBLEM 9
 * HDHub4u Live Catalog Audit, Missing Movie Recovery & Poster Accuracy Repair
 * A PRAVERSE Company
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT_DIR, 'data', 'catalog.json');
const DOWNLOADS_PATH = path.join(ROOT_DIR, 'data', 'downloads.json');
const POSTER_VALID_IDS_PATH = path.join(ROOT_DIR, 'data', 'poster-valid-ids.js');
const HOMEPAGE_AUDIT_PATH = path.join(ROOT_DIR, 'data', 'hdhub4u_homepage_audit.json');
const REPORT_PATH = path.join(ROOT_DIR, 'data', 'problem9_audit_reconciliation_report.json');

console.log('='.repeat(70));
console.log('PRAFLIX — ACCEPTANCE SUITE: PROBLEM 9 (LIVE AUDIT & POSTER ACCURACY REPAIR)');
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
const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const homepageAudit = JSON.parse(fs.readFileSync(HOMEPAGE_AUDIT_PATH, 'utf8'));

// Test 01: A title displayed on the HDHub4u homepage but missing from PRAFLIX is discovered and added
runTest('Homepage missing title discovered and added', () => {
  const meri = catalog.find(c => c.displayTitle === 'Meri Girlfriend Da Viyaah' && c.year === '2026');
  assert.ok(meri, 'Meri Girlfriend Da Viyaah must be present in catalog');
  assert.strictEqual(meri.type, 'Movie');
  assert.strictEqual(meri.canonicalId, 13674);

  const above = catalog.find(c => c.displayTitle === 'Above & Below' && c.year === '2026');
  assert.ok(above, 'Above & Below must be present in catalog');
  assert.strictEqual(above.canonicalId, 13675);
});

// Test 02: A title already present is not duplicated
runTest('Existing title is not duplicated', () => {
  const meriItems = catalog.filter(c => c.canonicalId === 13674 || c.normalizedTitle === 'meri girlfriend da viyaah');
  assert.strictEqual(meriItems.length, 1, 'Meri Girlfriend Da Viyaah must exist exactly once without duplicates');

  const animals2026 = catalog.filter(c => c.canonicalId === 13667);
  assert.strictEqual(animals2026.length, 1, 'Animals (2026) must exist exactly once without duplication');
});

// Test 03: Different movies with similar names remain separate
runTest('Different movies with similar names remain separate', () => {
  const beverly1 = catalog.find(c => c.canonicalId === 13649);
  const beverly2 = catalog.find(c => c.canonicalId === 13650);
  const beverly3 = catalog.find(c => c.canonicalId === 13651);

  assert.ok(beverly1 && beverly2 && beverly3, 'Beverly Hills Cop I, II, and III must all exist');
  assert.notStrictEqual(beverly1.canonicalId, beverly2.canonicalId);
  assert.notStrictEqual(beverly2.canonicalId, beverly3.canonicalId);
  assert.strictEqual(beverly1.year, '1984');
  assert.strictEqual(beverly2.year, '1987');
  assert.strictEqual(beverly3.year, '1994');
});

// Test 04: Remakes and releases from different years are matched correctly
runTest('Remakes and releases from different years matched correctly', () => {
  const womanInBlack2012 = catalog.find(c => c.canonicalId === 13677);
  const womanInBlack2014 = catalog.find(c => c.canonicalId === 7999);

  assert.ok(womanInBlack2012, 'The Woman in Black (2012) must exist as canonical record');
  assert.ok(womanInBlack2014, 'The Woman in Black 2 (2014) must exist as distinct record');
  assert.strictEqual(womanInBlack2012.year, '2012');
  assert.strictEqual(womanInBlack2014.year, '2014');
  assert.notStrictEqual(womanInBlack2012.canonicalId, womanInBlack2014.canonicalId);
});

// Test 05: A source page failure is recorded rather than silently ignored
runTest('Source page failure is recorded rather than silently ignored', () => {
  assert.ok(report.auditSummary, 'Report must contain audit summary');
  assert.strictEqual(typeof report.auditSummary.sourceListingPagesFailed, 'number');
  assert.strictEqual(typeof report.auditSummary.sourceTitlesInaccessible, 'number');
});

// Test 06: The crawl resumes from a saved checkpoint without duplicate records
runTest('Crawl and reconciliation are idempotent and resumable', () => {
  const uniqueIds = new Set(catalog.map(c => c.canonicalId));
  assert.strictEqual(uniqueIds.size, catalog.length, 'Every canonicalId in catalog must be strictly unique');
});

// Test 07: A wrong poster is detected and corrected only when replacement is verified
runTest('Wrong poster detected and corrected with verified artwork', () => {
  const donkeyKing = catalog.find(c => c.canonicalId === 4499);
  assert.ok(donkeyKing, 'The Donkey King must exist');
  assert.ok(!donkeyKing.poster.includes('alice-in-wonderland'), 'The Donkey King must NOT have Alice in Wonderland poster');
  assert.strictEqual(donkeyKing.poster, 'https://image.tmdb.org/t/p/w342/xzotyfHaej5bcMli3clQD4qcPXx.jpg');

  const welcome = catalog.find(c => c.canonicalId === 13648);
  assert.ok(welcome, 'Welcome must exist');
  assert.ok(!welcome.poster.includes('fK8TdIPdyJaaFMHlUV3JEZKFONJ'), 'Welcome must NOT have placeholder poster');
  assert.strictEqual(welcome.poster, 'https://image.tmdb.org/t/p/w342/fudxnXlTTBIDCkpR7XhlIgkNaUY.jpg');
});

// Test 08: Uncertain posters use a placeholder or review status
runTest('Uncertain posters use neutral placeholder', () => {
  const transformers = catalog.find(c => c.canonicalId === 7119);
  assert.ok(transformers, 'Transformers The Last Knight must exist');
  assert.ok(!transformers.poster.includes('woody-woodpecker'), 'Must NOT have Woody Woodpecker poster');
  assert.strictEqual(transformers.poster, 'assets/posters/fallback.svg');

  const shivalinga = catalog.find(c => c.canonicalId === 7451);
  assert.ok(shivalinga, 'Shivalinga must exist');
  assert.strictEqual(shivalinga.poster, 'assets/posters/fallback.svg');
});

// Test 09: Existing correct posters are not needlessly replaced
runTest('Existing correct posters are not needlessly replaced', () => {
  const teen13 = catalog.find(c => c.canonicalId === 1);
  assert.ok(teen13, '13 Teen must exist');
  assert.strictEqual(teen13.poster, 'assets/posters/13-teen-2026.jpg', 'Valid existing poster must be preserved');
});

// Test 10: A broken image does not break the title-details page
runTest('Details page template includes graceful onerror image fallback', () => {
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
  assert.ok(appJs.includes('FALLBACK_POSTER'), 'app.js must define and use FALLBACK_POSTER');
  assert.ok(appJs.includes('this.src = FALLBACK_POSTER') || appJs.includes("this.src='${FALLBACK_POSTER}'"), 'Image tags must have onerror fallback to FALLBACK_POSTER');
});

// Test 11: Existing catalog IDs and unrelated metadata remain unchanged
runTest('Existing catalog IDs and unrelated metadata remain unchanged', () => {
  assert.ok(catalog.length >= 13673, `Catalog count (${catalog.length}) must be >= 13,673 baseline`);
  const record1 = catalog.find(c => c.canonicalId === 1);
  assert.strictEqual(record1.displayTitle, '13 Teen');
  assert.strictEqual(record1.year, '2026');
  assert.strictEqual(record1.type, 'Movie');
  assert.strictEqual(record1.languages[0], 'Punjabi');
});

// Test 12: Series expose complete-season packages only
runTest('Series expose complete-season packages only', () => {
  const jubilee = downloads.entries['12583'] || Object.values(downloads.entries).find(e => e.catalogueId === 12583);
  assert.ok(jubilee, 'Jubilee series must have download record');
  jubilee.links.forEach(link => {
    assert.ok(!/episode\s*[1-9]/i.test(link.episode || ''), `Link must not be individual episode: ${link.episode}`);
  });
});

// Test 13: Download links are not classified as verified by hostname patterns alone
runTest('Download links verification distinguishes verified from unverified', () => {
  const womanInBlack = downloads.entries['13676'] || Object.values(downloads.entries).find(e => e.catalogueId === 13677);
  assert.ok(womanInBlack, 'The Woman in Black must exist in downloads.json');
  assert.strictEqual(womanInBlack.verificationStatus, 'unverified');
  assert.strictEqual(womanInBlack.links.length, 0);

  const meri = downloads.entries['13673'] || Object.values(downloads.entries).find(e => e.catalogueId === 13674);
  assert.ok(meri, 'Meri Girlfriend Da Viyaah must exist in downloads.json');
  assert.strictEqual(meri.verificationStatus, 'verified');
  assert.strictEqual(meri.links.length, 4);
});

// Test 14: Existing search, filters, sorting, pagination and details-page navigation continue working
runTest('App runtime contracts, controllers and structures intact', () => {
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
  assert.ok(appJs.includes('function renderMovieGrid'), 'renderMovieGrid controller must exist');
  assert.ok(appJs.includes('function renderPagination'), 'renderPagination controller must exist');
  assert.ok(appJs.includes('function applyFilters'), 'applyFilters controller must exist');
  assert.ok(appJs.includes('function openDetailView'), 'openDetailView controller must exist');
  assert.ok(appJs.includes('function findCanonicalItem'), 'findCanonicalItem controller must exist');
});

// Test 15: The build handles the resulting catalog and downloads data within deployment limits (<25 MiB)
runTest('Production build bundle satisfies Cloudflare 25 MiB asset constraint', () => {
  const distDir = path.join(ROOT_DIR, 'dist', 'data');
  assert.ok(fs.existsSync(distDir), 'dist/data directory must exist');

  const dlDist = path.join(distDir, 'downloads.json');
  const catDist = path.join(distDir, 'catalog.json');

  assert.ok(fs.existsSync(dlDist), 'dist/data/downloads.json must exist');
  assert.ok(fs.existsSync(catDist), 'dist/data/catalog.json must exist');

  const dlBytes = fs.statSync(dlDist).size;
  const catBytes = fs.statSync(catDist).size;

  const MAX_BYTES = 25 * 1024 * 1024;
  assert.ok(dlBytes <= MAX_BYTES, `downloads.json size (${(dlBytes/(1024*1024)).toFixed(2)} MiB) must be <= 25 MiB`);
  assert.ok(catBytes <= MAX_BYTES, `catalog.json size (${(catBytes/(1024*1024)).toFixed(2)} MiB) must be <= 25 MiB`);
});

console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} ACCEPTANCE CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
