#!/usr/bin/env node
/**
 * PRAFLIX — Production Repair Test Suite
 * A PRAVERSE Company
 *
 * Verifies all 7 core areas of the Production Repair:
 * 1. Title entity decoding & artifact stripping (xE02C, 8217, 8211, 038)
 * 2. The 6 target reported titles matching and resolution
 * 3. Ingestion gate: No title added to catalog without verified download links
 * 4. Incomplete imports tracked with clear reasons, not claimed as imported
 * 5. Strictly formatted Asia/Kolkata dates (DD/MM/YY) in title lists and reports
 * 6. 100% count parity between new catalog titles, TXT appends, and Telegram counts
 * 7. 4 distinct Telegram notification templates validation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(ROOT_DIR, 'data');

const titleDecoder = require('../scripts/title_decoder');
const titleListSync = require('../scripts/title_list_sync');
const {
  formatIstDateTime,
  formatDateTime,
  formatNewTitlesTelegramReport,
  formatIncompleteImportsWarning,
  formatProviderFailureNotification,
  formatTelegramReport,
  syncProvider,
  runFullSync
} = require('../scripts/sync_core');

console.log('='.repeat(70));
console.log('PRAFLIX — PRODUCTION REPAIR ACCEPTANCE TEST SUITE');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

let total = 0;
let passed = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED: ${err.message}`);
    throw err;
  }
}

// -------------------------------------------------------------------
// 1. Title Entity Decoding & Artifact Stripping
// -------------------------------------------------------------------
runTest('Safely decodes named, decimal, and hex HTML entities', () => {
  assert.strictEqual(titleDecoder.decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.strictEqual(titleDecoder.decodeHtmlEntities('Say &quot;Hello&quot;'), 'Say "Hello"');
  assert.strictEqual(titleDecoder.decodeHtmlEntities('Papa&#8217;s Friend'), "Papa's Friend");
  assert.strictEqual(titleDecoder.decodeHtmlEntities('Above &#038; Below'), 'Above & Below');
  assert.strictEqual(titleDecoder.decodeHtmlEntities('Title &#8211; Subtitle'), 'Title - Subtitle');
  // Hex entity for private-use icon font glyph &#xE02C; should be dropped
  assert.strictEqual(titleDecoder.decodeHtmlEntities('&#xE02C; Bhairadevi'), ' Bhairadevi');
});

runTest('Strips WordPress theme icon glyphs and residual artifacts (xE02C, 8217, 8211, 038)', () => {
  assert.strictEqual(titleDecoder.cleanTitle('&#xE02C; Bhairadevi (2024)'), 'Bhairadevi (2024)');
  assert.strictEqual(titleDecoder.cleanTitle('xE02C Bhairadevi (2024)'), 'Bhairadevi (2024)');
  assert.strictEqual(titleDecoder.cleanTitle('xe02c Bhairadevi (2024)'), 'Bhairadevi (2024)');
  assert.strictEqual(titleDecoder.cleanTitle('xE02C Papa 8217 s Friend'), "Papa's Friend");
  assert.strictEqual(titleDecoder.cleanTitle('Above 038 Below'), 'Above & Below');
  assert.strictEqual(titleDecoder.cleanTitle('Speed 8211 Fast'), 'Speed - Fast');
});

// -------------------------------------------------------------------
// 2. The 6 Specific Reported Titles Verification
// -------------------------------------------------------------------
runTest('Traces and cleans all 6 target reported titles with correct metadata', () => {
  const target1 = titleDecoder.cleanTitle('&#xE02C; Bhairadevi (2024)');
  assert.strictEqual(target1, 'Bhairadevi (2024)');

  const target2 = titleDecoder.cleanTitle('xE02C Premium Rush (2012)');
  assert.strictEqual(target2, 'Premium Rush (2012)');

  const target3 = titleDecoder.cleanTitle('xE02C Speed 2: Cruise Control (1997)');
  assert.strictEqual(target3, 'Speed 2: Cruise Control (1997)');

  const target4 = titleDecoder.cleanTitle('xE02C Speed (1994)');
  assert.strictEqual(target4, 'Speed (1994)');

  const target5 = titleDecoder.cleanTitle('xE02C The Silent Planet (2024)');
  assert.strictEqual(target5, 'The Silent Planet (2024)');

  const target6 = titleDecoder.cleanTitle('xE02C Papa 8217 s Friend');
  assert.strictEqual(target6, "Papa's Friend");
});

runTest('Normalizes Premium Rush and Speed 2 to match existing canonical catalog items', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'catalog.json'), 'utf8'));

  // 1. Premium Rush (2012) should match existing ID 8372
  const premNorm = titleDecoder.normalizeForMatching('xE02C Premium Rush (2012)');
  const premMatch = catalog.find(c => titleDecoder.normalizeForMatching(c.displayTitle, c.year) === premNorm);
  assert.ok(premMatch, 'Premium Rush must match in canonical catalog');
  assert.strictEqual(premMatch.canonicalId, 8372, 'Premium Rush must match canonical ID 8372');

  // 2. Speed 2: Cruise Control (1997) should match existing ID 9846
  const speed2Norm = titleDecoder.normalizeForMatching('xE02C Speed 2: Cruise Control (1997)');
  const speed2Match = catalog.find(c => titleDecoder.normalizeForMatching(c.displayTitle, c.year) === speed2Norm);
  assert.ok(speed2Match, 'Speed 2 Cruise Control must match in canonical catalog');
  assert.strictEqual(speed2Match.canonicalId, 9846, 'Speed 2 must match canonical ID 9846');
});

// -------------------------------------------------------------------
// 3. Download Links Ingestion Gate Invariant (Problem B)
// -------------------------------------------------------------------
runTest('Ingestion Gate: Candidate title with NO download links is strictly excluded from catalog and title list', async () => {
  const mockCatalog = [
    { canonicalId: 100, displayTitle: 'Existing Movie', year: '2020', type: 'Movie' }
  ];
  const mockSources = [];

  const candidateWithoutLinks = [
    {
      displayTitle: 'Lonely Incomplete Film',
      year: '2026',
      type: 'Movie',
      sourceUrl: 'https://mock.provider/film',
      links: [] // EMPTY LINKS!
    }
  ];

  const result = await syncProvider('HDWall', mockCatalog, mockSources, {
    mockItems: { 'HDWall': candidateWithoutLinks },
    dryRun: true
  });

  // Verify catalog was NOT modified
  assert.strictEqual(mockCatalog.length, 1, 'Catalog length must NOT increase for titles without links');
  assert.strictEqual(result.newCanonicalTitles.length, 0, 'No canonical titles should be claimed');
  assert.strictEqual(result.newlyIngestedCount, 0, 'newlyIngestedCount must be 0');
  assert.strictEqual(result.incompleteCount, 1, 'incompleteCount must be 1');
  assert.strictEqual(result.incompleteTitles.length, 1, 'incompleteTitles must contain the item');
  assert.strictEqual(result.incompleteTitles[0].title, 'Lonely Incomplete Film');
  assert.strictEqual(result.incompleteTitles[0].reason, 'no_eligible_links');
  assert.strictEqual(result.appendedToTitleListCount, 0, '0 titles must be appended to title list');
});

runTest('Ingestion Gate: Candidate title WITH verified download links is successfully ingested into catalog and title list', async () => {
  const mockCatalog = [
    { canonicalId: 100, displayTitle: 'Existing Movie', year: '2020', type: 'Movie' }
  ];
  const mockSources = [];

  const candidateWithLinks = [
    {
      displayTitle: 'Verified Complete Cinema',
      year: '2026',
      type: 'Movie',
      sourceUrl: 'https://mock.provider/cinema',
      links: [
        { downloadUrl: 'https://storage.googleapis.com/movie.mkv', resolution: '1080p' }
      ]
    }
  ];

  const result = await syncProvider('HDWall', mockCatalog, mockSources, {
    mockItems: { 'HDWall': candidateWithLinks },
    dryRun: true
  });

  assert.strictEqual(mockCatalog.length, 2, 'Catalog length must increase by 1 for title with verified links');
  assert.strictEqual(result.newCanonicalTitles.length, 1, 'Exactly 1 new canonical title claimed');
  assert.strictEqual(result.newlyIngestedCount, 1, 'newlyIngestedCount must be 1');
  assert.strictEqual(result.incompleteCount, 0, 'incompleteCount must be 0');
  assert.strictEqual(result.newCanonicalTitles[0].canonicalId, 101, 'Assigned next canonical ID 101');
  assert.strictEqual(result.appendedToTitleListCount, 1, 'Exactly 1 title appended to title list');
});

// -------------------------------------------------------------------
// 4. Strict Asia/Kolkata Date Formatting (Problem D)
// -------------------------------------------------------------------
runTest('formatTitleListDate strictly formats DD/MM/YY in Asia/Kolkata time zone', () => {
  // Test specific UTC midnight boundary: 2026-10-12T20:30:00Z is 2026-10-13 02:00 IST
  const lateUtc = new Date('2026-10-12T20:30:00.000Z');
  const formatted = titleListSync.formatTitleListDate(lateUtc);
  assert.strictEqual(formatted, '13/10/26', 'Must format in Asia/Kolkata (13/10/26), avoiding UTC runner drift');

  // Verify regex DD/MM/YY
  const todayFormatted = titleListSync.formatTitleListDate(new Date());
  assert.ok(/^\d{2}\/\d{2}\/\d{2}$/.test(todayFormatted), `Must match DD/MM/YY, got ${todayFormatted}`);
});

runTest('formatIstDateTime strictly formats in Asia/Kolkata with IST suffix', () => {
  const lateUtc = new Date('2026-10-12T20:30:00.000Z');
  const istStr = formatIstDateTime(lateUtc);
  assert.ok(istStr.includes('13/10/26'), 'Date part must be 13/10/26 in IST');
  assert.ok(istStr.includes('02:00 AM IST') || istStr.includes('2:00 AM IST'), `Time must be 02:00 AM IST, got ${istStr}`);
  assert.ok(istStr.endsWith('IST'), 'Must end with IST timezone marker');
});

// -------------------------------------------------------------------
// 5. Title List Deduplication & 100% Count Parity (Problem E)
// -------------------------------------------------------------------
runTest('Title List Sync prevents duplicates and preserves order', () => {
  const titles = ['New Unique Title 2026', 'New Unique Title 2026'];
  const res = titleListSync.syncProviderTitleList('hdhub4u', titles, { dryRun: true });
  assert.strictEqual(res.appendedCount, 1, 'Duplicate within same batch must be skipped (appended 1)');
  assert.strictEqual(res.skippedCount, 1, 'Duplicate within same batch must be counted as skipped (1)');
});

runTest('Enforces 100% count parity: newlyIngestedCount === appendedToTitleListCount === newCanonicalTitles.length', async () => {
  const mockCatalog = [
    { canonicalId: 50, displayTitle: 'First', year: '2021', type: 'Movie' }
  ];
  const mockSources = [];

  const candidates = [
    {
      displayTitle: 'Eligible Alpha',
      year: '2026',
      type: 'Movie',
      links: [{ downloadUrl: 'https://cdn.example.com/alpha.mp4', resolution: '720p' }]
    },
    {
      displayTitle: 'Incomplete Beta',
      year: '2026',
      type: 'Movie',
      links: [] // Missing links
    },
    {
      displayTitle: 'Eligible Gamma',
      year: '2026',
      type: 'Web Series',
      links: [{ downloadUrl: 'https://cdn.example.com/gamma.mp4', resolution: '1080p' }]
    }
  ];

  const result = await syncProvider('10Moviez', mockCatalog, mockSources, {
    mockItems: { '10Moviez': candidates },
    dryRun: true
  });

  // Parity check:
  assert.strictEqual(result.newlyIngestedCount, 2, 'Must have 2 newly ingested titles');
  assert.strictEqual(result.newCanonicalTitles.length, 2, 'Must have 2 new canonical title objects');
  assert.strictEqual(result.appendedToTitleListCount, 2, 'Must append exactly 2 titles to title list');
  assert.strictEqual(result.incompleteCount, 1, 'Must have 1 incomplete title');
  assert.strictEqual(result.newlyIngestedCount, result.appendedToTitleListCount, 'Ingested count must equal title list count');
});

// -------------------------------------------------------------------
// 6. 4 Distinct Telegram Notification Formats (Problem F)
// -------------------------------------------------------------------
runTest('Format 1: formatNewTitlesTelegramReport generates required template with movies, series, and counts', () => {
  const report = formatNewTitlesTelegramReport({
    provider: 'HDHub4u',
    runTime: '13/10/26 10:00 AM IST',
    newTitles: [
      { displayTitle: 'Kalki 2898 AD', year: '2024', type: 'Movie' },
      { displayTitle: 'Mirzapur', year: '2024', type: 'Web Series' }
    ],
    validationStatus: 'Passed',
    deploymentStatus: 'Confirmed successful'
  });

  assert.ok(report.includes('PRAFLIX — NEW TITLES ADDED'), 'Must have correct header');
  assert.ok(report.includes('Provider: HDHub4u'), 'Must show provider');
  assert.ok(report.includes('Run time: 13/10/26 10:00 AM IST'), 'Must show run time in IST');
  assert.ok(report.includes('Movies added:\n- Kalki 2898 AD (2024)'), 'Must list movies');
  assert.ok(report.includes('Web series added:\n- Mirzapur (2024)'), 'Must list web series');
  assert.ok(report.includes('- New movies: 1'), 'Must show movies count');
  assert.ok(report.includes('- New web series: 1'), 'Must show series count');
  assert.ok(report.includes('- Total new canonical titles: 2'), 'Must show total count');
  assert.ok(report.includes('Catalog validation: Passed'), 'Must confirm validation');
  assert.ok(report.includes('Deployment: Confirmed successful'), 'Must confirm deployment');
});

runTest('Format 2: formatTelegramReport generates daily zero-new-title report', () => {
  const summary = {
    runTimeIst: '13/10/26 10:00 AM IST',
    targetProvider: 'HDHub4u',
    providers: {
      'HDHub4u': { failed: false, newMovies: 0, newSeries: 0, liveCrawl: { liveReachable: true, liveDiscoveredCount: 20 } }
    },
    totals: { moviesAdded: 0, seriesAdded: 0, totalTitlesAdded: 0, currentCatalogTotal: 13687 }
  };

  const report = formatTelegramReport(summary);
  assert.ok(report.includes('PRAFLIX REPORT'), 'Must include header');
  assert.ok(report.includes('DAILY CATALOG UPDATE'), 'Must include daily update label');
  assert.ok(report.includes('✅ No new titles found today.'), 'Must clearly state no new titles found');
  assert.ok(report.includes('🚀 Edge Deployment: Catalog Verified'), 'Must confirm catalog verified');
});

runTest('Format 3: formatIncompleteImportsWarning reports incomplete titles and protects catalog', () => {
  const report = formatIncompleteImportsWarning({
    provider: 'HDHub4u',
    runTime: '13/10/26 10:00 AM IST',
    incompleteTitles: [
      { displayTitle: 'Missing Links Movie', year: '2024', reason: 'no_eligible_links' }
    ]
  });

  assert.ok(report.includes('PRAFLIX — INCOMPLETE IMPORTS WARNING'), 'Must have incomplete header');
  assert.ok(report.includes('Titles with missing download links or assets (excluded from catalog):'), 'Must state exclusion');
  assert.ok(report.includes('- Missing Links Movie (2024) — Reason: no_eligible_links'), 'Must list titles with reasons');
  assert.ok(report.includes('Action taken: Preserved existing catalog (zero empty titles imported)'), 'Must confirm action');
});

runTest('Format 4: formatProviderFailureNotification alerts without corrupting catalog', () => {
  const report = formatProviderFailureNotification({
    provider: '10Moviez',
    runTime: '13/10/26 10:00 AM IST',
    error: 'HTTP 503 Service Temporarily Unavailable'
  });

  assert.ok(report.includes('PRAFLIX — PROVIDER CRAWL FAILED'), 'Must have failure header');
  assert.ok(report.includes('Provider: 10Moviez'), 'Must state provider');
  assert.ok(report.includes('Error details: HTTP 503 Service Temporarily Unavailable'), 'Must state error');
  assert.ok(report.includes('Catalog validation: Preserved existing catalog (no partial modification)'), 'Must confirm catalog preservation');
});

// -------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------
console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} PRODUCTION REPAIR CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
