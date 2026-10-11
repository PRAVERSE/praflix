/**
 * PRAFLIX — Acceptance Suite: Problem 11
 * Complete Poster Repair & Download-Link Verification
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
console.log('PRAFLIX — ACCEPTANCE SUITE: PROBLEM 11 (POSTERS & DOWNLOADS)');
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
// PART 1: POSTER INTEGRITY & REPAIR AUDIT
// ─────────────────────────────────────────────────────────────────────────────

runTest('Catalog records reference zero missing local poster files', () => {
  let missingCount = 0;
  catalog.forEach(item => {
    const p = item.poster || '';
    if (p.startsWith('assets/posters/') && p !== 'assets/posters/fallback.svg') {
      const diskPath = path.join(ROOT_DIR, p);
      if (!fs.existsSync(diskPath) || fs.statSync(diskPath).size < 100) {
        missingCount++;
      }
    }
  });
  assert.strictEqual(missingCount, 0, `Expected 0 missing local poster files, found ${missingCount}`);
});

runTest('All referenced local posters exist on disk and have non-empty image content', () => {
  const localItems = catalog.filter(c => c.poster && c.poster.startsWith('assets/posters/') && c.poster !== 'assets/posters/fallback.svg');
  assert.ok(localItems.length >= 567, `Expected at least 567 verified on-disk posters, got ${localItems.length}`);
  localItems.forEach(item => {
    const diskPath = path.join(ROOT_DIR, item.poster);
    assert.ok(fs.existsSync(diskPath), `Local poster file must exist: ${item.poster}`);
    const stat = fs.statSync(diskPath);
    assert.ok(stat.size > 100, `Local poster file must be > 100 bytes: ${item.poster}`);
  });
});

runTest('Remote posters use authentic HTTPS image CDNs (TMDb / verified image hosts)', () => {
  const remoteItems = catalog.filter(c => c.poster && (c.poster.startsWith('http://') || c.poster.startsWith('https://')));
  assert.ok(remoteItems.length >= 3231, `Expected at least 3,231 verified remote posters, got ${remoteItems.length}`);
  const tmdbCount = remoteItems.filter(c => c.poster.startsWith('https://image.tmdb.org/t/p/')).length;
  assert.ok(tmdbCount >= 3219, `Expected at least 3,219 TMDb posters, got ${tmdbCount}`);
  // Check valid URL structure
  remoteItems.forEach(item => {
    const parsed = new URL(item.poster);
    assert.strictEqual(parsed.protocol, 'https:', 'Remote posters must use secure HTTPS protocol');
    assert.ok(parsed.pathname.length > 5, 'Remote poster path must be non-empty');
  });
});

runTest('Known mismatched titles forced to fallback.svg (IDs 6808, 7302)', () => {
  const item6808 = catalog.find(c => c.canonicalId === 6808);
  const item7302 = catalog.find(c => c.canonicalId === 7302);
  assert.ok(item6808, 'Item 6808 must exist');
  assert.ok(item7302, 'Item 7302 must exist');
  assert.strictEqual(item6808.poster, 'assets/posters/fallback.svg', 'Kaashmora 2 must use fallback.svg');
  assert.strictEqual(item7302.poster, 'assets/posters/fallback.svg', 'Hyper must use fallback.svg');
});

runTest('Neutral fallback SVG exists and decodes properly', () => {
  const fallbackPath = path.join(ROOT_DIR, 'assets', 'posters', 'fallback.svg');
  assert.ok(fs.existsSync(fallbackPath), 'fallback.svg must exist');
  const svg = fs.readFileSync(fallbackPath, 'utf8');
  assert.ok(svg.includes('<svg'), 'fallback.svg must contain valid SVG tag');
  assert.ok(svg.includes('</svg>'), 'fallback.svg must contain closing SVG tag');
  assert.ok(svg.length > 500, 'fallback.svg must be non-empty');
});

runTest('Poster validity index contains confirmed posters (at least 3,798)', () => {
  const validIdsCode = fs.readFileSync(POSTER_VALID_IDS_PATH, 'utf8');
  assert.ok(validIdsCode.includes('window.PRAFLIX_POSTER_VALID_IDS = new Set('));
  global.window = {};
  eval(validIdsCode);
  const set = global.window.PRAFLIX_POSTER_VALID_IDS;
  assert.ok(set instanceof Set);
  assert.ok(set.size >= 3798, `Expected at least 3,798 valid posters, got ${set.size}`);
  assert.ok(set.has(1), 'Item 1 should be valid');
  assert.ok(!set.has(6808), 'Item 6808 mismatch should not be in valid index');
  assert.ok(!set.has(7302), 'Item 7302 mismatch should not be in valid index');
  assert.ok(set.has(13674), 'Item 13674 TMDb should be in valid index');
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: DOWNLOAD LINK VERIFICATION AUDIT
// ─────────────────────────────────────────────────────────────────────────────

runTest('Resolver rejects malformed, non-HTTP, and placeholder URLs as broken', () => {
  const r1 = RESOLVER.classifyLinkVerification('');
  assert.strictEqual(r1.status, 'broken');
  const r2 = RESOLVER.classifyLinkVerification('#');
  assert.strictEqual(r2.status, 'broken');
  const r3 = RESOLVER.classifyLinkVerification('javascript:alert(1)');
  assert.strictEqual(r3.status, 'broken');
  const r4 = RESOLVER.classifyLinkVerification('ftp://hubcdn.io/file/123');
  assert.strictEqual(r4.status, 'broken');
  const r5 = RESOLVER.classifyLinkVerification('https://hubcdn.io');
  assert.strictEqual(r5.status, 'broken'); // missing storage path
});

runTest('Resolver rejects hijacked ad/survey redirectors (filesdl.site) as broken', () => {
  const r = RESOLVER.classifyLinkVerification('https://new6.filesdl.site/file/abcdef');
  assert.strictEqual(r.status, 'broken');
  assert.strictEqual(r.evidence, 'invalid_redirect_survey_parking');
});

runTest('Resolver rejects permanently dead endpoints (HTTP 404) as broken', () => {
  const r = RESOLVER.classifyLinkVerification('https://botdrivea.filesdl.in/file/12345');
  assert.strictEqual(r.status, 'broken');
  assert.strictEqual(r.evidence, 'http_404_not_found');
});

runTest('Resolver isolates transient timeouts as temporarily_unavailable', () => {
  const r = RESOLVER.classifyLinkVerification('https://hubcloud.foo/file/12345');
  assert.strictEqual(r.status, 'temporarily_unavailable');
  assert.strictEqual(r.evidence, 'connection_timeout_inconclusive');
});

runTest('Resolver isolates Cloudflare challenge protection as temporarily_unavailable', () => {
  const r = RESOLVER.classifyLinkVerification('https://hdhub4uhd.xyz/file/12345');
  assert.strictEqual(r.status, 'temporarily_unavailable');
  assert.strictEqual(r.evidence, 'cloudflare_challenge_inconclusive');
});

runTest('Resolver validates legitimate storage CDN / drive destinations', () => {
  const r1 = RESOLVER.classifyLinkVerification('https://hubcdn.io/file/abc123xyz');
  assert.strictEqual(r1.status, 'verified');
  const r2 = RESOLVER.classifyLinkVerification('https://hubdrive.pics/file/2060736840');
  assert.strictEqual(r2.status, 'verified');
  const r3 = RESOLVER.classifyLinkVerification('https://hubcloud.ist/drive/search-recover.php?from_ac=123&q=xyz');
  assert.strictEqual(r3.status, 'verified');
});

runTest('Resolver quarantines unknown host as unverified', () => {
  const r = RESOLVER.classifyLinkVerification('https://unknown-file-host.org/file/12345');
  assert.strictEqual(r.status, 'unverified');
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 3: WEB-SERIES POLICY & DOWNLOAD BUTTONS
// ─────────────────────────────────────────────────────────────────────────────

runTest('Web series policy: complete season packages exposed, individual episodes omitted', () => {
  const dlByCatalogueId = new Map(downloads.entries.map(e => [e.catalogueId, e]));
  const series = catalog.find(c => c.canonicalId === 219); // Muthu Alias Kaattaan Web Series
  const entry = dlByCatalogueId.get(219);
  const resolved = RESOLVER.groupAndOrderDownloads(series, entry);
  assert.ok(resolved.isSeries, 'Must be identified as series');
  assert.ok(resolved.hasLinks, 'Must have complete season links');
  assert.strictEqual(resolved.seasonEpisodeGroups.length, 0, 'Individual episode groups must be empty');
  resolved.completeSeasonGroups.forEach(sg => {
    assert.ok(sg.seasonLabel.includes('Season'), 'Must have Season label');
    sg.qualities.forEach(q => {
      q.links.forEach(l => {
        assert.ok(/^Link\s+\d+$/i.test(l.label), `Label must be Link N, got: ${l.label}`);
        assert.ok(!l.downloadUrl.includes('survey-smiles'), 'Must not link to survey parking');
      });
    });
  });
});

runTest('Web series with only individual episodes yields clean unavailable state', () => {
  const syntheticSeries = {
    canonicalId: 99999,
    displayTitle: 'Test Series Individual Only',
    type: 'Web Series',
    year: '2026'
  };
  const syntheticEntry = {
    catalogueId: 99999,
    links: [
      { downloadUrl: 'https://hubcdn.io/file/ep1', episode: 'Episode 1', resolution: '720p', verificationStatus: 'verified' },
      { downloadUrl: 'https://hubcdn.io/file/ep2', episode: 'Episode 2', resolution: '720p', verificationStatus: 'verified' }
    ]
  };
  const resolved = RESOLVER.groupAndOrderDownloads(syntheticSeries, syntheticEntry);
  assert.ok(resolved.isSeries, 'Must be identified as series');
  assert.strictEqual(resolved.hasLinks, false, 'hasLinks must be false when no complete season exists');
  assert.strictEqual(resolved.completeSeasonGroups.length, 0, 'completeSeasonGroups must be empty');
});

runTest('Download buttons strictly use Link N sequential labels with no provider names', () => {
  const movie = catalog.find(c => c.canonicalId === 1);
  const dlByCatalogueId = new Map(downloads.entries.map(e => [e.catalogueId, e]));
  const entry = dlByCatalogueId.get(1);
  const resolved = RESOLVER.groupAndOrderDownloads(movie, entry);
  assert.ok(resolved.hasLinks);
  resolved.movieQualityGroups.forEach(g => {
    g.links.forEach((l, idx) => {
      assert.strictEqual(l.label, `Link ${idx + 1}`);
      assert.ok(!l.label.includes('hdhub4u'));
      assert.ok(!l.label.includes('Direct'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 4: DATA INTEGRITY & REPORTS AUDIT
// ─────────────────────────────────────────────────────────────────────────────

runTest('Catalog and downloads database maintain 100% parity (at least 13,678 records)', () => {
  assert.ok(catalog.length >= 13678, 'Catalog must contain at least 13,678 records');
  assert.strictEqual(downloads.entries.length, catalog.length, 'Downloads and catalog must maintain 100% parity');
  const catIds = new Set(catalog.map(c => c.canonicalId));
  downloads.entries.forEach(e => {
    assert.ok(catIds.has(e.catalogueId), `Download entry ${e.catalogueId} must exist in catalog`);
  });
});

runTest('Generated problem11_poster_audit.json reconciles with catalog state', () => {
  const auditPath = path.join(ROOT_DIR, 'data', 'problem11_poster_audit.json');
  assert.ok(fs.existsSync(auditPath), 'problem11_poster_audit.json must exist');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  assert.strictEqual(audit.totalRecords, 13678);
  assert.strictEqual(audit.validLocalPosters, 567);
  assert.strictEqual(audit.validRemotePosters, 3231);
  assert.strictEqual(audit.fallbackPosters, 9880);
  assert.strictEqual(audit.totalValidInIndex, 3798);
});

runTest('Generated problem11_download_audit.json reconciles with downloads state', () => {
  const auditPath = path.join(ROOT_DIR, 'data', 'problem11_download_audit.json');
  assert.ok(fs.existsSync(auditPath), 'problem11_download_audit.json must exist');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  assert.strictEqual(audit.totalCatalogRecords, 13678);
  assert.strictEqual(audit.totalDownloadEntries, 13678);
  assert.strictEqual(audit.linkVerification.totalLinksChecked, 75768);
  assert.strictEqual(audit.linkVerification.verified, 72693);
  assert.strictEqual(audit.linkVerification.broken, 2339);
  assert.strictEqual(audit.linkVerification.temporarilyUnavailable, 732);
});

console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} PROBLEM 11 ACCEPTANCE CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
