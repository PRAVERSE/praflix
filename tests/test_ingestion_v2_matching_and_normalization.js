/**
 * Test Suite: Record Normalization & Hierarchical Matching Engine
 * Validates:
 * 1. Normalizer transforms messy release titles into canonical schema.
 * 2. Genuinely new movie detection.
 * 3. Genuinely new web series detection.
 * 4. Existing title receives new provider variant.
 * 5. Distinct release years with similar names are NOT merged (e.g. 2025 vs 2026).
 * 6. Movies vs Web Series sharing same name are NOT merged.
 * 7. Different seasons of the same series are treated as separate canonical records.
 * 8. Ambiguous matches are routed to the review queue.
 * 9. Exact duplicate records are skipped idempotently.
 */

const assert = require('assert');
const { Normalizer } = require('../ingestion_v2/normalization/normalizer');
const { MatchingEngine } = require('../ingestion_v2/matching/matching_engine');

function runTests() {
  console.log('='.repeat(65));
  console.log('TEST SUITE: NORMALIZATION & HIERARCHICAL MATCHING');
  console.log('='.repeat(65));

  const normalizer = new Normalizer();

  // --- Test 1: Normalizer movie parsing ---
  console.log('\n[Test 1] Normalizer: movie release parsing...');
  const rawMovie = {
    provider: 'HDHub4u',
    originalSourceTitle: 'Weapons (2026) WEB-DL [Hindi DD5.1 & English] 4K 1080p 720p & 480p [x264/HEVC] | Full Movie',
    sourceUrl: 'https://new7.hdhub4u.cl/weapons-2026-hindi-movie/',
    sourcePosterUrl: 'https://catimages.co/posters/weapons-2026.jpg',
    downloadLinks: [
      { quality: '1080p', url: 'https://hubdrive.pics/file/101' },
      { quality: '720p', url: 'https://hubdrive.pics/file/102' }
    ]
  };

  const normMovie = normalizer.normalizeRecord(rawMovie);
  assert.strictEqual(normMovie.displayTitle, 'Weapons');
  assert.strictEqual(normMovie.year, '2026');
  assert.strictEqual(normMovie.type, 'Movie');
  assert.strictEqual(normMovie.season, null);
  assert.ok(normMovie.qualities.includes('1080p'));
  assert.ok(normMovie.qualities.includes('720p'));
  assert.strictEqual(normMovie.variants.length, 1);
  assert.strictEqual(normMovie.variants[0].source, 'hdhub4u');
  console.log('  ✓ Normalized movie release metadata correctly.');

  // --- Test 2: Normalizer web series parsing ---
  console.log('\n[Test 2] Normalizer: web series release parsing...');
  const rawSeries = {
    provider: '10Moviez',
    originalSourceTitle: 'Free The Trap (2026) Season 1 All Episodes [Hindi ORG. + Multi Audio] Complete Netflix Original Web Series',
    sourceUrl: 'https://10moviez.biz/free-the-trap-2026-season-1-all-episodes-hindi/',
    sourcePosterUrl: 'https://10moviez.biz/posters/the-trap-s1.jpg',
    downloadLinks: []
  };

  const normSeries = normalizer.normalizeRecord(rawSeries);
  assert.strictEqual(normSeries.displayTitle, 'The Trap');
  assert.strictEqual(normSeries.year, '2026');
  assert.strictEqual(normSeries.type, 'Web Series');
  assert.strictEqual(normSeries.season, 'Season 1');
  console.log('  ✓ Normalized web series release metadata with Season 1 extraction.');

  // --- Baseline Mock Catalog ---
  const baselineCatalog = [
    {
      id: 'praflix-1',
      canonicalId: 1,
      displayTitle: 'Pushpa 2: The Rule',
      year: '2024',
      type: 'Movie',
      season: null,
      variants: [
        { source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/pushpa-2-2024-hindi/' }
      ]
    },
    {
      id: 'praflix-2',
      canonicalId: 2,
      displayTitle: 'Weapons',
      year: '2025',
      type: 'Movie',
      season: null,
      variants: [
        { source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/weapons-2025-english/' }
      ]
    },
    {
      id: 'praflix-3',
      canonicalId: 3,
      displayTitle: 'Mirzapur',
      year: '2018',
      type: 'Web Series',
      season: 'Season 1',
      variants: [
        { source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/mirzapur-season-1/' }
      ]
    }
  ];

  const matchingEngine = new MatchingEngine(baselineCatalog);

  // --- Test 3: Genuinely new movie detection ---
  console.log('\n[Test 3] MatchingEngine: Genuinely new movie detection...');
  const brandNewMovie = {
    displayTitle: 'Avatar 3: Fire and Ash',
    year: '2026',
    type: 'Movie',
    season: null,
    variants: [{ source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/avatar-3-2026/' }]
  };

  const evalNew = matchingEngine.evaluateBatch([brandNewMovie]);
  assert.strictEqual(evalNew.newCanonicalTitles.length, 1);
  assert.strictEqual(evalNew.newCanonicalTitles[0].displayTitle, 'Avatar 3: Fire and Ash');
  assert.strictEqual(evalNew.newCanonicalTitles[0].canonicalId, 4, 'Should increment to next canonicalId (4)');
  assert.strictEqual(evalNew.existingTitlesUpdated.length, 0);
  console.log('  ✓ Detected genuinely new movie and assigned next canonicalId (4).');

  // --- Test 4: Existing title receives new provider variant ---
  console.log('\n[Test 4] MatchingEngine: Existing title receives new provider variant...');
  const incoming10mVariant = {
    displayTitle: 'Pushpa 2: The Rule',
    year: '2024',
    type: 'Movie',
    season: null,
    variants: [{ source: '10moviez', sourceUrl: 'https://10moviez.biz/pushpa-2-the-rule-2024/' }]
  };

  const evalVariant = matchingEngine.evaluateBatch([incoming10mVariant]);
  assert.strictEqual(evalVariant.existingTitlesUpdated.length, 1);
  assert.strictEqual(evalVariant.existingTitlesUpdated[0].canonicalId, 1);
  assert.strictEqual(evalVariant.newCanonicalTitles.length, 0);
  console.log('  ✓ Matched existing title praflix-1 and attached 10Moviez variant.');

  // --- Test 5: Distinct years with same title are NOT merged ---
  console.log('\n[Test 5] MatchingEngine: Same title with distinct year (2025 vs 2026) NOT merged...');
  const weapons2026 = {
    displayTitle: 'Weapons',
    year: '2026',
    type: 'Movie',
    season: null,
    variants: [{ source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/weapons-2026-hindi/' }]
  };

  const evalWeapons = matchingEngine.evaluateBatch([weapons2026]);
  // 2025 vs 2026 has a 1-year diff or flagged as ambiguous / new
  assert.ok(
    evalWeapons.newCanonicalTitles.length === 1 || evalWeapons.ambiguousRecords.length === 1,
    'Weapons 2026 must NEVER be silently merged into Weapons 2025!'
  );
  assert.strictEqual(evalWeapons.existingTitlesUpdated.length, 0);
  console.log('  ✓ Preserved release year integrity; Weapons 2026 not collapsed into Weapons 2025.');

  // --- Test 6: Movie vs Web Series sharing same name are NOT merged ---
  console.log('\n[Test 6] MatchingEngine: Movie vs Web Series with identical title NOT merged...');
  const mirzapurMovie = {
    displayTitle: 'Mirzapur',
    year: '2026',
    type: 'Movie', // Catalog has Mirzapur as Web Series
    season: null,
    variants: [{ source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/mirzapur-the-film-2026/' }]
  };

  const evalTypeMismatch = matchingEngine.evaluateBatch([mirzapurMovie]);
  assert.strictEqual(evalTypeMismatch.existingTitlesUpdated.length, 0, 'Must NOT merge Movie into Web Series');
  assert.strictEqual(evalTypeMismatch.newCanonicalTitles.length, 1);
  console.log('  ✓ Movie and Web Series partitioned into distinct canonical records.');

  // --- Test 7: Multi-season web series partition ---
  console.log('\n[Test 7] MatchingEngine: Different seasons of same series treated as separate canonical items...');
  const mirzapurSeason2 = {
    displayTitle: 'Mirzapur',
    year: '2020',
    type: 'Web Series',
    season: 'Season 2', // Catalog has Season 1
    variants: [{ source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/mirzapur-season-2/' }]
  };

  const evalSeason = matchingEngine.evaluateBatch([mirzapurSeason2]);
  assert.strictEqual(evalSeason.existingTitlesUpdated.length, 0, 'Season 2 must NOT merge into Season 1');
  assert.strictEqual(evalSeason.newCanonicalTitles.length, 1);
  console.log('  ✓ Preserved multi-season distinction (Season 2 is separate canonical entry).');

  // --- Test 8: Duplicate record skipped (Idempotency) ---
  console.log('\n[Test 8] MatchingEngine: Duplicate record skipped idempotently...');
  const exactDuplicate = {
    displayTitle: 'Pushpa 2: The Rule',
    year: '2024',
    type: 'Movie',
    season: null,
    variants: [{ source: 'hdhub4u', sourceUrl: 'https://new7.hdhub4u.cl/pushpa-2-2024-hindi/' }]
  };

  const evalDup = matchingEngine.evaluateBatch([exactDuplicate]);
  assert.strictEqual(evalDup.duplicateRecords.length, 1);
  assert.strictEqual(evalDup.newCanonicalTitles.length, 0);
  assert.strictEqual(evalDup.existingTitlesUpdated.length, 0);
  console.log('  ✓ Idempotency verified: duplicate source records skipped without altering catalog.');

  console.log('\n[PASS] All Normalization & Hierarchical Matching tests passed cleanly.\n');
}

if (require.main === module) {
  try {
    runTests();
  } catch (err) {
    console.error('\n[TEST FAILURE]', err);
    process.exit(1);
  }
}

module.exports = { runTests };
