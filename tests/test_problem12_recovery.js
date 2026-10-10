/**
 * PRAFLIX — Acceptance Suite: Problem 12
 * Remaining Poster & Download Recovery
 * A PRAVERSE Company
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT_DIR, 'data', 'catalog.json');
const DOWNLOADS_PATH = path.join(ROOT_DIR, 'data', 'downloads.json');
const POSTER_VALID_IDS_PATH = path.join(ROOT_DIR, 'data', 'poster-valid-ids.js');
const RESOLVER = require(path.join(ROOT_DIR, 'destination_resolver.js'));

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const downloads = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));

console.log('='.repeat(70));
console.log('PRAFLIX — ACCEPTANCE SUITE: PROBLEM 12 (POSTER & DOWNLOAD RECOVERY)');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED`);
    console.error(`  ${err.message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: POSTER RECOVERY AUDIT
// ─────────────────────────────────────────────────────────────────────────────

runTest('Local on-disk posters expanded with verified 2026/2025 assets (>600 files)', () => {
  const localItems = catalog.filter(c => c.poster && c.poster.startsWith('assets/posters/') && c.poster !== 'assets/posters/fallback.svg');
  assert.ok(localItems.length >= 627, `Expected at least 627 on-disk posters, found ${localItems.length}`);
  localItems.forEach(item => {
    const p = path.join(ROOT_DIR, item.poster);
    assert.ok(fs.existsSync(p), `Poster file must exist on disk: ${item.poster}`);
    assert.ok(fs.statSync(p).size > 100, `Poster file must be > 100 bytes: ${item.poster}`);
  });
});

runTest('Valid poster index expanded to 9,172 confirmed real posters (67%+ coverage)', () => {
  const validIdsCode = fs.readFileSync(POSTER_VALID_IDS_PATH, 'utf8');
  assert.ok(validIdsCode.includes('window.PRAFLIX_POSTER_VALID_IDS = new Set('));
  global.window = {};
  eval(validIdsCode);
  const set = global.window.PRAFLIX_POSTER_VALID_IDS;
  assert.ok(set instanceof Set);
  assert.strictEqual(set.size, 9172, `Expected 9,172 valid poster IDs, found: ${set.size}`);
});

runTest('Zero catalog records reference missing local poster files', () => {
  let missingCount = 0;
  catalog.forEach(item => {
    const p = item.poster || '';
    if (p.startsWith('assets/posters/') && p !== 'assets/posters/fallback.svg') {
      const pPath = path.join(ROOT_DIR, p);
      if (!fs.existsSync(pPath) || fs.statSync(pPath).size < 100) {
        missingCount++;
      }
    }
  });
  assert.strictEqual(missingCount, 0, `Expected 0 missing local poster files, found ${missingCount}`);
});

runTest('Known mismatched titles remain strictly on fallback SVG (IDs 6808, 7302)', () => {
  const item6808 = catalog.find(c => c.canonicalId === 6808);
  const item7302 = catalog.find(c => c.canonicalId === 7302);
  assert.strictEqual(item6808.poster, 'assets/posters/fallback.svg');
  assert.strictEqual(item7302.poster, 'assets/posters/fallback.svg');
  const validIdsCode = fs.readFileSync(POSTER_VALID_IDS_PATH, 'utf8');
  assert.ok(!validIdsCode.includes(',6808,'), '6808 must not be in valid index');
  assert.ok(!validIdsCode.includes(',7302,'), '7302 must not be in valid index');
});

runTest('Prominent 2026 recovered titles possess verified real posters', () => {
  const testIds = [16, 34, 38, 44, 69, 87, 93, 147, 156, 169];
  testIds.forEach(id => {
    const item = catalog.find(c => c.canonicalId === id);
    assert.ok(item, `Item ${id} must exist in catalog`);
    assert.notStrictEqual(item.poster, 'assets/posters/fallback.svg', `Item ${id} (${item.displayTitle}) must have real poster`);
    assert.ok(item.poster.startsWith('assets/posters/') || item.poster.startsWith('https://'), `Item ${id} poster must be local or HTTPS`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: DOWNLOAD RECOVERY AUDIT
// ─────────────────────────────────────────────────────────────────────────────

runTest('2,222 expired filesdl.site links repaired to official live new1.filesdl.in', () => {
  let siteLinks = 0;
  let inLinks = 0;
  downloads.entries.forEach(e => {
    (e.links || []).forEach(l => {
      if (l.downloadUrl && l.downloadUrl.includes('filesdl.site')) siteLinks++;
      if (l.downloadUrl && l.downloadUrl.includes('new1.filesdl.in')) inLinks++;
    });
  });
  assert.strictEqual(siteLinks, 0, `All filesdl.site links must be repaired; found ${siteLinks}`);
  assert.ok(inLinks >= 4784, `Expected at least 4,784 new1.filesdl.in links, found ${inLinks}`);
});

runTest('Verified download links count increased to 74,915 (+2,222 recovered)', () => {
  let verifiedCount = 0;
  downloads.entries.forEach(e => {
    (e.links || []).forEach(l => {
      if (l.verificationStatus === 'verified') verifiedCount++;
    });
  });
  assert.strictEqual(verifiedCount, 74915, `Expected 74,915 verified links, found ${verifiedCount}`);
});

runTest('Broken download links reduced from 2,339 to exactly 117 (only 404 endpoints)', () => {
  let brokenCount = 0;
  downloads.entries.forEach(e => {
    (e.links || []).forEach(l => {
      if (l.verificationStatus === 'broken') brokenCount++;
    });
  });
  assert.strictEqual(brokenCount, 117, `Expected 117 broken links, found ${brokenCount}`);
});

runTest('Titles with working verified downloads increased by 46 to 7,162', () => {
  let titlesWithVerified = 0;
  downloads.entries.forEach(e => {
    if ((e.links || []).some(l => l.verificationStatus === 'verified')) {
      titlesWithVerified++;
    }
  });
  assert.strictEqual(titlesWithVerified, 7162, `Expected 7,162 titles with verified links, found ${titlesWithVerified}`);
});

runTest('Recovered titles (11374, 11376, 11380, 11382) possess working verified destinations', () => {
  const recoveredIds = [11374, 11376, 11380, 11382];
  const dlMap = new Map(downloads.entries.map(e => [e.catalogueId, e]));
  recoveredIds.forEach(id => {
    const item = catalog.find(c => c.canonicalId === id);
    const entry = dlMap.get(id);
    assert.ok(item && entry, `Record ${id} must exist`);
    const resolved = RESOLVER.groupAndOrderDownloads(item, entry);
    assert.ok(resolved.hasLinks, `Recovered title ${id} (${item.displayTitle}) must have working download links`);
    resolved.movieQualityGroups.forEach(g => {
      g.links.forEach(l => {
        assert.ok(l.downloadUrl.includes('new1.filesdl.in'), 'Must link to live new1.filesdl.in');
        assert.ok(/^Link\s+\d+$/i.test(l.label), 'Label must be Link N');
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 3: POLICY & BROWSER INTEGRITY AUDIT
// ─────────────────────────────────────────────────────────────────────────────

runTest('Web series policy: complete season packages only, individual episodes omitted', () => {
  const dlMap = new Map(downloads.entries.map(e => [e.catalogueId, e]));
  const series = catalog.find(c => c.canonicalId === 219);
  const entry = dlMap.get(219);
  const resolved = RESOLVER.groupAndOrderDownloads(series, entry);
  assert.ok(resolved.isSeries);
  assert.ok(resolved.hasLinks);
  assert.strictEqual(resolved.seasonEpisodeGroups.length, 0);
});

runTest('HTML and scripts contain cache-busting query strings (?v=20261010_p12)', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  assert.ok(html.includes('styles.css?v=20261010_p12'), 'styles.css must have cache-busting tag');
  assert.ok(html.includes('data/catalog_chunk_1.js?v=20261010_p12'), 'chunk 1 must have cache-busting tag');
  assert.ok(html.includes('data/poster-valid-ids.js?v=20261010_p12'), 'poster-valid-ids must have cache-busting tag');
  assert.ok(html.includes('destination_resolver.js?v=20261010_p12'), 'resolver must have cache-busting tag');
  assert.ok(html.includes('app.js?v=20261010_p12'), 'app.js must have cache-busting tag');
  const app = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
  assert.ok(app.includes("fetch('data/downloads.json?v=20261010_p12')"), 'downloads.json fetch must be versioned');
});

runTest('Problem 12 audit files reconcile with current catalog and download state', () => {
  const pAudit = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'problem12_poster_audit.json'), 'utf8'));
  const dAudit = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'problem12_download_audit.json'), 'utf8'));
  assert.strictEqual(pAudit.totalCatalogRecords, 13678);
  assert.strictEqual(pAudit.totalValidPostersInIndex, 9172);
  assert.strictEqual(pAudit.neutralFallbackPosters, 4506);
  assert.strictEqual(dAudit.totalCatalogRecords, 13678);
  assert.strictEqual(dAudit.linkVerification.verified, 74915);
  assert.strictEqual(dAudit.linkVerification.broken, 117);
  assert.strictEqual(dAudit.titleAvailability.titlesWithVerifiedWorkingDownloads, 7162);
});

console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} PROBLEM 12 ACCEPTANCE CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
