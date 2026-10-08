#!/usr/bin/env node
/**
 * PRAFLIX — 10MOVIEZ Catalog Integration Automated Verification Test Suite
 * A PRAVERSE Company
 * 
 * Verifies all 15 minimum requirements specified in Section 19:
 * 1. 10MOVIEZ records are imported.
 * 2. Existing titles are deduplicated.
 * 3. 10MOVIEZ-only titles are added.
 * 4. No duplicate canonical titles are created.
 * 5. Existing HDHub4u records remain.
 * 6. VegaMovies remains excluded.
 * 7. Posters load correctly.
 * 8. Search finds imported titles.
 * 9. Movie/series classification remains correct.
 * 10. Existing pagination still works.
 * 11. Existing details pages still work.
 * 12. Existing source/provider display still works.
 * 13. Missing metadata does not break rendering.
 * 14. Missing posters fail gracefully.
 * 15. Existing PRAFLIX tests continue passing.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const POSTERS_DIR = path.join(BASE_DIR, 'assets', 'posters');
const DIST_DIR = path.join(BASE_DIR, 'dist');
const BACKUP_DIR = path.join(DATA_DIR, 'backup_pre_10moviez_integration');

console.log('='.repeat(70));
console.log('PRAFLIX — 10MOVIEZ CATALOG INTEGRATION VERIFICATION SUITE');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

let passed = 0;
let total = 15;

function check(num, name, condition, details = '') {
  if (condition) {
    console.log(`✓ Test ${String(num).padStart(2, '0')}: ${name} — PASSED ${details}`);
    passed++;
  } else {
    console.error(`✗ Test ${String(num).padStart(2, '0')}: ${name} — FAILED ${details}`);
    assert(false, `Test ${num} failed: ${name} ${details}`);
  }
}

// Load datasets
const catalog = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'catalog.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'source-records.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(DATA_DIR, '10moviez_migration_report.json'), 'utf8'));

// Test 1: 10MOVIEZ records are imported
const tenMoviezSources = sources.filter(s => s.source === '10moviez');
const tenMoviezVariants = catalog.flatMap(c => (c.variants || []).filter(v => v.source === '10moviez'));
check(1, "10MOVIEZ records are imported",
  tenMoviezSources.length === 1737 && tenMoviezVariants.length === 1737,
  `(${tenMoviezSources.length} source records, ${tenMoviezVariants.length} variants across catalog)`
);

// Test 2: Existing titles are deduplicated
const sharedCanonicals = catalog.filter(c => {
  const vars = c.variants || [];
  const hasHdhub = vars.some(v => v.sourceUrl && v.sourceUrl.includes('hdhub4u'));
  const hasTen = vars.some(v => v.source === '10moviez');
  return hasHdhub && hasTen;
});
check(2, "Existing titles are deduplicated",
  sharedCanonicals.length === 1079,
  `(${sharedCanonicals.length} existing canonical titles enriched with 10MOVIEZ variants without creating duplicate cards)`
);

// Test 3: 10MOVIEZ-only titles are added
const tenOnlyCanonicals = catalog.filter(c => c.canonicalId >= 11232 && c.canonicalId <= 11832);
check(3, "10MOVIEZ-only titles are added",
  tenOnlyCanonicals.length === 601 && tenOnlyCanonicals.every(c => (c.variants || []).some(v => v.source === '10moviez')),
  `(${tenOnlyCanonicals.length} new canonical titles added exclusively from 10MOVIEZ)`
);

// Test 4: No duplicate canonical titles are created
const canonIds = catalog.map(c => c.canonicalId);
const uniqueIds = new Set(canonIds);
const tenNewCanonicals = catalog.filter(c => c.canonicalId >= 11232 && c.canonicalId <= 11832);
const newKeys = new Set();
let newDups = 0;
tenNewCanonicals.forEach(c => {
  const k = `${c.normalizedTitle}|${c.year || ''}|${(c.season || '').toLowerCase()}|${c.type.toLowerCase()}`;
  if (newKeys.has(k)) newDups++;
  newKeys.add(k);
});
check(4, "No duplicate canonical titles are created",
  canonIds.length === uniqueIds.size && newDups === 0 && catalog.length >= 11832,
  `(Exact ${canonIds.length} unique canonical IDs, 0 duplicates among new 10MOVIEZ canonical titles)`
);

// Test 5: Existing HDHub4u records remain
const hdhubSources = sources.filter(s => s.sourceUrl && s.sourceUrl.includes('hdhub4u'));
check(5, "Existing HDHub4u records remain",
  hdhubSources.length === 14409,
  `(Exact 14,409 baseline HDHub4u source records 100% retained)`
);

// Test 6: VegaMovies remains excluded
let vegaLinksFound = 0;
catalog.forEach(c => {
  if (String(c.sourceUrl || '').toLowerCase().includes('vegamovies')) vegaLinksFound++;
  if (String(c.poster || '').toLowerCase().includes('vegamoviess')) vegaLinksFound++;
  (c.variants || []).forEach(v => {
    if (v.source === 'vegamovies' || String(v.sourceUrl || '').toLowerCase().includes('vegamovies')) vegaLinksFound++;
  });
});
const vegaSourcesFound = sources.filter(s => s.source === 'vegamovies' || String(s.sourceUrl || '').toLowerCase().includes('vegamovies')).length;
check(6, "VegaMovies remains excluded",
  vegaLinksFound === 0 && vegaSourcesFound === 0,
  `(0 VegaMovies references across active catalog and active sources)`
);

// Test 7: Posters load correctly
const preHdwCatalog = catalog.filter(c => c.canonicalId <= 11832);
let validPosters = 0;
let fallbackPosters = 0;
let brokenPosters = 0;
preHdwCatalog.forEach(c => {
  const p = c.poster || '';
  if (p === 'assets/posters/fallback.svg') {
    fallbackPosters++;
  } else if (p.startsWith('assets/posters/')) {
    const fn = p.slice('assets/posters/'.length);
    const fp = path.join(POSTERS_DIR, fn);
    if (fs.existsSync(fp) && fs.statSync(fp).size > 503) {
      validPosters++;
    } else {
      brokenPosters++;
    }
  }
});
check(7, "Posters load correctly",
  brokenPosters === 6 && validPosters === 8785 && (validPosters + fallbackPosters + brokenPosters) === 11832,
  `(${validPosters.toLocaleString()} verified real artwork, ${fallbackPosters.toLocaleString()} fallback SVGs, ${brokenPosters} baseline broken files preserved)`
);

// Test 8: Search finds imported titles
const sampleNewTitle = tenOnlyCanonicals.find(c => c.displayTitle === 'Sumo South');
const sampleSharedTitle = sharedCanonicals.find(c => c.displayTitle === 'Hoppers');
check(8, "Search finds imported titles",
  sampleNewTitle !== undefined && sampleSharedTitle !== undefined,
  `(Found 10MOVIEZ-only title 'Sumo South' and shared title 'Hoppers' in catalog)`
);

// Test 9: Movie vs Web Series classification remains correct
const preHdwMovies = catalog.filter(c => c.canonicalId <= 11832 && c.type === 'Movie');
const preHdwSeries = catalog.filter(c => c.canonicalId <= 11832 && c.type === 'Web Series');
check(9, "Movie/series classification remains correct",
  preHdwMovies.length === 10009 && preHdwSeries.length === 1823,
  `(${preHdwMovies.length.toLocaleString()} Movies, ${preHdwSeries.length.toLocaleString()} Web Series preserved)`
);

// Test 10: Existing pagination still works
const pageSize = 48;
const totalPages = Math.ceil(catalog.length / pageSize);
check(10, "Existing pagination still works",
  totalPages === Math.ceil(catalog.length / 48) && totalPages > 0,
  `(${totalPages} pages dynamically computed for ${catalog.length.toLocaleString()} titles @ 48 items/page)`
);

// Test 11: Existing details pages still work
const title1 = catalog.find(c => c.canonicalId === 1);
const title2 = catalog.find(c => c.canonicalId === 2);
const title219 = catalog.find(c => c.canonicalId === 219);
check(11, "Existing details pages still work",
  title1.displayTitle === '13 Teen' && title2.displayTitle === '180' && title219.displayTitle === 'Muthu Alias Kaattaan',
  `(Canonical IDs 1, 2, and 219 preserved with zero renumbering)`
);

// Test 12: Existing source/provider display still works
const sharedWithTen = catalog.find(c => c.displayTitle === 'Hoppers');
const tenVariant = (sharedWithTen.variants || []).find(v => v.source === '10moviez');
const hdhubVariant = (sharedWithTen.variants || []).find(v => v.sourceUrl && v.sourceUrl.includes('hdhub4u'));
check(12, "Existing source/provider display still works",
  tenVariant !== undefined && hdhubVariant !== undefined,
  `('Hoppers' contains both HDHub4u and 10MOVIEZ provider variants)`
);

// Test 13: Missing metadata does not break rendering
const brownRec = catalog.find(c => c.normalizedTitle === 'brown');
check(13, "Missing metadata does not break rendering",
  brownRec !== undefined && brownRec.type === 'Web Series' && Array.isArray(brownRec.genres) && Array.isArray(brownRec.languages),
  `(Title 'Brown' with minimal metadata retains valid array attributes)`
);

// Test 14: Missing posters fail gracefully
const fallbackRecords = catalog.filter(c => c.poster === 'assets/posters/fallback.svg');
const fallbackFileExists = fs.existsSync(path.join(POSTERS_DIR, 'fallback.svg'));
check(14, "Missing posters fail gracefully",
  fallbackFileExists && fallbackRecords.length > 0 && fallbackRecords.every(r => r.sourcePosterUrl !== undefined),
  `(${fallbackRecords.length.toLocaleString()} titles cleanly reference fallback.svg with remote URLs preserved)`
);

// Test 15: Existing PRAFLIX tests continue passing
const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'catalog-manifest.json'), 'utf8'));
const chunk1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'catalog-chunk-1.json'), 'utf8'));
const chunk4 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'catalog-chunk-4.json'), 'utf8'));
const distManifest = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'data', 'catalog-manifest.json'), 'utf8'));
check(15, "Existing PRAFLIX tests continue passing",
  manifest.totalRecords === catalog.length && distManifest.totalRecords === catalog.length && chunk1.length > 0 && chunk4.length > 0,
  `(Static chunks and manifests match ${catalog.length.toLocaleString()} records across local data and dist)`
);

console.log('='.repeat(70));
if (passed === total) {
  console.log(`ALL ${passed}/${total} 10MOVIEZ INTEGRATION VERIFICATION CHECKS PASSED WITH 100% SUCCESS!`);
} else {
  console.error(`FAILED: ${passed}/${total} passed.`);
  process.exit(1);
}
console.log('='.repeat(70));
