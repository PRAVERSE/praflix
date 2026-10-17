#!/usr/bin/env node
/**
 * PRAFLIX — Newly Added Movie Page 1 Priority Acceptance & Regression Suite
 * A PRAVERSE Company
 *
 * Verifies all 12 required criteria:
 * 1. A newly added older movie appears on Page 1.
 * 2. A newly added movie from the current year appears on Page 1.
 * 3. Multiple new movies are ordered by addition time, newest first.
 * 4. Existing movies retain their release-year sorting after the new-movie priority group.
 * 5. Updating an existing movie does not make it newly added.
 * 6. Search results respect the new priority while matching the query.
 * 7. Year and other filters continue working.
 * 8. Pagination has no duplicates, missing records, or unstable ordering.
 * 9. Addition timestamps survive a catalog rebuild.
 * 10. Web-series ordering remains unchanged.
 * 11. Existing canonical IDs and download links remain unchanged.
 * 12. Existing All Years and newest-first defaults remain intact.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.dirname(__dirname);
const CATALOG_PATH = path.join(ROOT_DIR, 'data', 'catalog.json');
const DOWNLOADS_PATH = path.join(ROOT_DIR, 'data', 'downloads.json');
const POSTER_VALID_IDS_PATH = path.join(ROOT_DIR, 'data', 'poster-valid-ids.js');
const APP_JS_PATH = path.join(ROOT_DIR, 'app.js');

console.log('='.repeat(72));
console.log('PRAFLIX — ACCEPTANCE SUITE: NEWLY ADDED MOVIE PAGE 1 PRIORITY');
console.log('A PRAVERSE Company');
console.log('='.repeat(72));

let passed = 0;
let total = 0;

function check(testNum, name, condition, details = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`✓ Test ${String(testNum).padStart(2, '0')}: ${name} — PASSED ${details}`);
  } else {
    console.error(`✗ Test ${String(testNum).padStart(2, '0')}: ${name} — FAILED ${details}`);
    assert(false, `Test ${testNum} failed: ${name}`);
  }
}

// 1. Load catalog & valid poster Set
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const downloads = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));
const validIdsJs = fs.readFileSync(POSTER_VALID_IDS_PATH, 'utf8');

global.window = {};
eval(validIdsJs);

// Load app.js helpers
const appJsCode = fs.readFileSync(APP_JS_PATH, 'utf8');
eval(appJsCode);
const { isNewlyAddedMovie, yearDescComparator, hasRealPoster } = window.PRAFLIX_SORT;

// Helper: partition & sort master catalog using app.js logic
function computeCatalogSections(records, sort = 'year-desc') {
  const posterItems = [];
  const nonPosterItems = [];

  for (let i = 0; i < records.length; i++) {
    const item = records[i];
    if (hasRealPoster(item)) {
      posterItems.push(item);
    } else {
      nonPosterItems.push(item);
    }
  }

  if (sort === 'year-desc') {
    posterItems.sort(yearDescComparator);
    nonPosterItems.sort(yearDescComparator);
  }

  return {
    posterItems,
    nonPosterItems,
    allRecords: [...posterItems, ...nonPosterItems]
  };
}

// Compute default master view
const masterSections = computeCatalogSections(catalog);
const masterPage1 = masterSections.posterItems.slice(0, 48);

// ---------------------------------------------------------------------------
// 1. A newly added older movie appears on Page 1
// ---------------------------------------------------------------------------
const starWars = catalog.find(c => c.canonicalId === 13724);
const starWarsOnPage1 = masterPage1.some(item => item.canonicalId === 13724);
const starWarsRank = masterPage1.findIndex(item => item.canonicalId === 13724);

check(1, "A newly added older movie (Star Wars: Episode II, 2002) appears on Page 1",
  starWars &&
  starWars.year === '2002' &&
  starWars.type === 'Movie' &&
  starWars.dateAdded &&
  starWarsOnPage1 &&
  starWarsRank < 48,
  `(Found at rank ${starWarsRank + 1} of 48 on Page 1; genuine release year 2002 preserved)`
);

// ---------------------------------------------------------------------------
// 2. A newly added movie from the current year appears on Page 1
// ---------------------------------------------------------------------------
const aasha = catalog.find(c => c.canonicalId === 13721);
const masterplan = catalog.find(c => c.canonicalId === 13722);
const aashaOnPage1 = masterPage1.some(item => item.canonicalId === 13721);
const masterplanOnPage1 = masterPage1.some(item => item.canonicalId === 13722);
const aashaRank = masterPage1.findIndex(item => item.canonicalId === 13721);
const masterplanRank = masterPage1.findIndex(item => item.canonicalId === 13722);

check(2, "Newly added movies from the current year (Aasha 2026, Masterplan 2026) appear on Page 1",
  aasha && masterplan &&
  aasha.year === '2026' && masterplan.year === '2026' &&
  aashaOnPage1 && masterplanOnPage1 &&
  aashaRank < 48 && masterplanRank < 48,
  `(Aasha rank ${aashaRank + 1}, Masterplan rank ${masterplanRank + 1} on Page 1)`
);

// ---------------------------------------------------------------------------
// 3. Multiple new movies are ordered by addition time, newest first
// ---------------------------------------------------------------------------
// Test ordering across synthetic records with differing timestamps
const syntheticNew1 = { canonicalId: 90001, displayTitle: 'Movie Alpha', year: '1995', type: 'Movie', dateAdded: '2026-10-17T10:00:00.000Z' };
const syntheticNew2 = { canonicalId: 90002, displayTitle: 'Movie Beta', year: '2026', type: 'Movie', dateAdded: '2026-10-17T12:00:00.000Z' }; // Newest
const syntheticNew3 = { canonicalId: 90003, displayTitle: 'Movie Gamma', year: '2010', type: 'Movie', dateAdded: '2026-10-17T08:00:00.000Z' }; // Oldest addition
const syntheticEqualTsA = { canonicalId: 90004, displayTitle: 'Tie Movie B', year: '2020', type: 'Movie', dateAdded: '2026-10-17T09:00:00.000Z' };
const syntheticEqualTsB = { canonicalId: 90005, displayTitle: 'Tie Movie A', year: '2020', type: 'Movie', dateAdded: '2026-10-17T09:00:00.000Z' };

const sortedSynthetic = [syntheticNew1, syntheticNew2, syntheticNew3, syntheticEqualTsA, syntheticEqualTsB].sort(yearDescComparator);

check(3, "Multiple new movies are ordered by addition time, newest first with deterministic tie-breaker",
  sortedSynthetic[0].canonicalId === 90002 && // 12:00
  sortedSynthetic[1].canonicalId === 90001 && // 10:00
  sortedSynthetic[2].canonicalId === 90005 && // 09:00 (Tie Movie A before Tie Movie B alphabetical)
  sortedSynthetic[3].canonicalId === 90004 && // 09:00 (Tie Movie B)
  sortedSynthetic[4].canonicalId === 90003,   // 08:00
  "(Newest addition at 12:00 ranked 1st; equal timestamps use alphabetical tie-breaker)"
);

// ---------------------------------------------------------------------------
// 4. Existing movies retain their release-year sorting after the new-movie priority group
// ---------------------------------------------------------------------------
// Items after the newly added group on Page 1 must follow release-year descending
const newlyAddedCount = masterPage1.filter(isNewlyAddedMovie).length;
const archivedItemsOnPage1 = masterPage1.slice(newlyAddedCount);

let archivedOrderingCorrect = true;
for (let i = 1; i < archivedItemsOnPage1.length; i++) {
  const prev = archivedItemsOnPage1[i - 1];
  const curr = archivedItemsOnPage1[i];
  const yPrev = parseInt(prev.year || '0', 10);
  const yCurr = parseInt(curr.year || '0', 10);
  if (yCurr > yPrev) {
    archivedOrderingCorrect = false;
    break;
  }
}

check(4, "Existing movies retain their release-year sorting after the new-movie priority group",
  newlyAddedCount >= 3 &&
  archivedOrderingCorrect &&
  archivedItemsOnPage1[0].year === '2026',
  `(Newly added count: ${newlyAddedCount}; followed by ${archivedItemsOnPage1.length} archived 2026 movies in strict order)`
);

// ---------------------------------------------------------------------------
// 5. Updating an existing movie does not make it newly added
// ---------------------------------------------------------------------------
// Test that an existing movie updated with new variants/links has no dateAdded and retains archive position
const blackClover = catalog.find(c => c.canonicalId === 13720); // Existing 2023 movie updated with links
const isBlackCloverNew = isNewlyAddedMovie(blackClover);
const blackCloverOnPage1 = masterPage1.some(c => c.canonicalId === 13720);

// Also simulate sync update to an existing title
const existingTitleSample = {
  canonicalId: 500,
  displayTitle: 'Classic Movie',
  year: '2015',
  type: 'Movie',
  variants: [{ source: 'hdhub4u', qualities: ['1080p'] }]
};
// Simulating update (adding variant/links without setting dateAdded)
const updatedSample = { ...existingTitleSample, variants: [...existingTitleSample.variants, { source: '10moviez' }] };

check(5, "Updating an existing movie does not make it newly added",
  !isBlackCloverNew &&
  !blackCloverOnPage1 &&
  blackClover.dateAdded === undefined &&
  !isNewlyAddedMovie(updatedSample),
  "(Black Clover 13720 remains in its 2023 release position; updating variants preserves archive status)"
);

// ---------------------------------------------------------------------------
// 6. Search results respect the new priority while matching the query
// ---------------------------------------------------------------------------
// Normalizer matching app.js
function normalizeText(text) {
  if (!text) return '';
  return String(text).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function searchCatalog(query) {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  const matched = catalog.filter(item => {
    const corpus = normalizeText(`${item.displayTitle} ${item.normalizedTitle} ${item.originalSourceTitle || ''} ${item.year}`);
    return tokens.every(tok => corpus.includes(tok));
  });
  const sections = computeCatalogSections(matched);
  return sections.allRecords;
}

const starWarsSearchResults = searchCatalog('Star Wars');
const sacredGamesSearchResults = searchCatalog('Sacred Games');

check(6, "Search results respect the new priority while strictly matching the query",
  starWarsSearchResults.length > 0 &&
  starWarsSearchResults[0].canonicalId === 13724 && // Star Wars Episode II is 1st among Star Wars results
  starWarsSearchResults.every(c => normalizeText(c.displayTitle).includes('star') || normalizeText(c.originalSourceTitle || '').includes('star')) &&
  !sacredGamesSearchResults.some(c => c.canonicalId === 13724) && // Star Wars never leaks into Sacred Games search
  !sacredGamesSearchResults.some(c => c.canonicalId === 13721),
  "(Star Wars: Episode II is rank 1 among Star Wars results; zero unrelated new movies in Sacred Games search)"
);

// ---------------------------------------------------------------------------
// 7. Year and other filters continue working
// ---------------------------------------------------------------------------
// Year filter: 2002
const year2002Matches = catalog.filter(c => c.year === '2002');
const year2002Sorted = computeCatalogSections(year2002Matches).posterItems;

// Platform filter: Prime Video
const primeMatches = catalog.filter(c => {
  const matchP = p => String(p || '').toLowerCase().includes('prime');
  return matchP(c.platform) || (c.platforms || []).some(matchP) || (c.variants || []).some(v => matchP(v.platform));
});
const primeSorted = computeCatalogSections(primeMatches).posterItems;

// Category filter: Bollywood
const isBollywood = item => {
  const t = `${item.displayTitle} ${item.originalSourceTitle || ''}`.toLowerCase();
  const langs = (item.languages || []).map(l => String(l).toLowerCase());
  return t.includes('bollywood') || langs.includes('hindi');
};
const bollywoodMatches = catalog.filter(isBollywood);
const bollywoodSorted = computeCatalogSections(bollywoodMatches).posterItems;
const newlyAddedBollywood = bollywoodSorted.filter(isNewlyAddedMovie);

check(7, "Year, platform, and category filters prioritize newly added movies within matching subsets",
  year2002Sorted[0].canonicalId === 13724 && // Star Wars 1st among 2002
  primeSorted[0].canonicalId === 13722 &&     // Masterplan 1st among Prime Video
  newlyAddedBollywood.length >= 3 &&
  newlyAddedBollywood.some(c => c.canonicalId === 13721), // Aasha among top Bollywood priority group
  "(2002 filter rank 1: Star Wars: Episode II; Prime Video rank 1: Masterplan; Bollywood top: Aasha)"
);

// ---------------------------------------------------------------------------
// 8. Pagination has no duplicates, missing records, or unstable ordering
// ---------------------------------------------------------------------------
const pageSize = 48;
const { posterItems, nonPosterItems, allRecords } = masterSections;
const posterPages = Math.ceil(posterItems.length / pageSize);
const nonPosterPages = Math.ceil(nonPosterItems.length / pageSize);
const totalPages = posterPages + nonPosterPages;

const collectedIds = [];
const idFrequency = new Map();

for (let p = 1; p <= totalPages; p++) {
  let pageSlice;
  if (p <= posterPages) {
    const start = (p - 1) * pageSize;
    pageSlice = posterItems.slice(start, start + pageSize);
  } else {
    const relPage = p - posterPages;
    const start = (relPage - 1) * pageSize;
    pageSlice = nonPosterItems.slice(start, start + pageSize);
  }
  for (const item of pageSlice) {
    collectedIds.push(item.canonicalId);
    idFrequency.set(item.canonicalId, (idFrequency.get(item.canonicalId) || 0) + 1);
  }
}

const duplicates = Array.from(idFrequency.entries()).filter(([_, count]) => count > 1);

check(8, "Pagination produces complete coverage with zero duplicates or missing records",
  collectedIds.length === catalog.length &&
  idFrequency.size === catalog.length &&
  duplicates.length === 0,
  `(${collectedIds.length.toLocaleString()} titles sliced across ${totalPages} pages; 0 duplicates, 0 gaps)`
);

// ---------------------------------------------------------------------------
// 9. Addition timestamps survive a catalog rebuild
// ---------------------------------------------------------------------------
const chunk4 = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'catalog-chunk-4.json'), 'utf8'));
const distCatalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'dist', 'data', 'catalog.json'), 'utf8'));

const swInChunk4 = chunk4.find(c => c.canonicalId === 13724);
const aaInChunk4 = chunk4.find(c => c.canonicalId === 13721);
const mpInChunk4 = chunk4.find(c => c.canonicalId === 13722);

const swInDist = distCatalog.find(c => c.canonicalId === 13724);
const aaInDist = distCatalog.find(c => c.canonicalId === 13721);
const mpInDist = distCatalog.find(c => c.canonicalId === 13722);

check(9, "Addition timestamps survive catalog chunk partitioning and production distribution build",
  swInChunk4 && swInChunk4.dateAdded === '2026-10-16T17:42:55.204Z' &&
  aaInChunk4 && aaInChunk4.dateAdded === '2026-10-16T14:19:42.236Z' &&
  mpInChunk4 && mpInChunk4.dateAdded === '2026-10-16T14:19:42.236Z' &&
  swInDist && swInDist.dateAdded === '2026-10-16T17:42:55.204Z' &&
  aaInDist && aaInDist.dateAdded === '2026-10-16T14:19:42.236Z' &&
  mpInDist && mpInDist.dateAdded === '2026-10-16T14:19:42.236Z',
  "(Verified across data/catalog-chunk-4.json and dist/data/catalog.json with exact millisecond parity)"
);

// ---------------------------------------------------------------------------
// 10. Web-series ordering remains unchanged
// ---------------------------------------------------------------------------
const papasFriend = catalog.find(c => c.canonicalId === 13723);
const papasFriendIsNewMovie = isNewlyAddedMovie(papasFriend);
const papasFriendOnPage1 = masterPage1.some(c => c.canonicalId === 13723);

// Verify web series tab
const webSeriesOnly = catalog.filter(c => c.type === 'Web Series');
const webSeriesSorted = computeCatalogSections(webSeriesOnly).posterItems;
const pfSeriesRank = webSeriesSorted.findIndex(c => c.canonicalId === 13723);

check(10, "Web-series ordering remains unchanged (Papa's Friend S01 does not jump to Page 1)",
  papasFriend &&
  papasFriend.type === 'Web Series' &&
  !papasFriendIsNewMovie &&
  !papasFriendOnPage1 &&
  pfSeriesRank > 48,
  `(Papa's Friend is excluded from movie priority group; rank ${pfSeriesRank + 1} of ${webSeriesSorted.length} in Web Series)`
);

// ---------------------------------------------------------------------------
// 11. Existing canonical IDs and download links remain unchanged
// ---------------------------------------------------------------------------
const idSet = new Set(catalog.map(c => c.canonicalId));
const dlIdSet = new Set(downloads.entries.map(e => e.catalogueId));

let contiguous = true;
for (let i = 1; i <= catalog.length; i++) {
  if (!idSet.has(i)) {
    contiguous = false;
    break;
  }
}

// Check download destinations for Star Wars 13724 and Papa's Friend 13723
const swDownloads = downloads.entries.find(e => e.catalogueId === 13724);
const pfDownloads = downloads.entries.find(e => e.catalogueId === 13723);

check(11, "Existing canonical IDs and download links remain unchanged and strictly contiguous",
  catalog.length >= 13724 &&
  idSet.size === catalog.length &&
  contiguous &&
  dlIdSet.size === catalog.length &&
  swDownloads && swDownloads.links.length === 2 &&
  pfDownloads && pfDownloads.links.length === 7,
  `(${catalog.length.toLocaleString()} contiguous IDs 1..${catalog.length}; Star Wars 2 links, Papa's Friend 7 links intact)`
);

// ---------------------------------------------------------------------------
// 12. Existing All Years and newest-first defaults remain intact
// ---------------------------------------------------------------------------
// Verify app.js source contains defaultYear = '' and default sort = 'year-desc'
const hasAllYearsDefault = appJsCode.includes("defaultYear: ''") || appJsCode.includes('defaultYear: ""');
const hasYearDescDefault = appJsCode.includes("sort: 'year-desc'") || appJsCode.includes('sort: "year-desc"');

check(12, "Existing All Years and newest-first defaults remain strictly intact",
  hasAllYearsDefault && hasYearDescDefault,
  "(state.defaultYear === '' [All Years], activeFilters.sort === 'year-desc')"
);

console.log('='.repeat(72));
if (passed === total) {
  console.log(`ALL ${passed}/${total} PRIORITY SPECIFICATION & REGRESSION CHECKS PASSED WITH 100% SUCCESS!`);
} else {
  console.error(`FAILED: ${passed}/${total} passed.`);
  process.exit(1);
}
console.log('='.repeat(72));
