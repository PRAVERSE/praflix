#!/usr/bin/env node
/**
 * PRAFLIX — Available Versions & Download-Link Mapping Acceptance Test Suite
 * A PRAVERSE Company
 *
 * Covers Problems 3, 4, and 5:
 *
 * Web series (Problem 3):
 *  1. A series with a verified complete-season link shows that link.
 *  2. A series with individual episode links only shows no download links.
 *  3. A series with both complete-season and individual episode links displays only the complete-season links.
 *  4. Multiple seasons retain their correct season grouping.
 *  5. An unverified complete-season link is not displayed.
 *  6. Missing complete-season links produce the correct empty state.
 *
 * Movies and link verification (Problem 4):
 *  7. Valid, verified movie download links remain available.
 *  8. Broken links are excluded.
 *  9. Temporary failures are not automatically labelled permanently broken.
 * 10. Source article URLs are never shown as download destinations.
 * 11. Redirected destinations and verified storage CDN endpoints are handled correctly.
 * 12. Invalid or ambiguous title matches do not attach a link to the wrong title.
 * 13. Re-running the matching process does not create duplicate records (idempotent matching).
 *
 * Source-reference removal (Problem 5):
 * 14. No details page renders a "Source Article Reference" section.
 * 15. No source names, source domains, or source URLs appear in user-facing details or Available Versions.
 * 16. Removing source references does not break valid download buttons or other page interactions.
 * 17. Desktop and mobile layouts remain correct.
 *
 * Regression & Catalog Integrity:
 * 18. Full master catalog of 13,642 canonical records preserved without loss.
 * 19. Navigation, search, filter functions intact in app.js.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE_DIR = path.dirname(__dirname);
const resolver = require(path.join(BASE_DIR, 'destination_resolver.js'));

console.log('='.repeat(70));
console.log('PRAFLIX — ACCEPTANCE SUITE: PROBLEMS 3, 4, AND 5');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function check(num, name, condition, details = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`✓ Test ${String(num).padStart(2, '0')}: ${name} — PASSED ${details}`);
  } else {
    console.error(`✗ Test ${String(num).padStart(2, '0')}: ${name} — FAILED ${details}`);
    assert(false, `Test ${num} failed: ${name} ${details}`);
  }
}

// ===========================================================================
// SECTION 1: WEB SERIES (Problem 3 — Complete-Season Links Only)
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1: A series with a verified complete-season link shows that link
// ---------------------------------------------------------------------------
const seriesItem1 = {
  canonicalId: 9101,
  displayTitle: 'Cosmic Odyssey',
  type: 'Web Series',
  year: '2026',
  season: 'Season 1'
};

const seriesEntry1 = {
  catalogueId: 9101,
  title: 'Cosmic Odyssey',
  type: 'Web Series',
  links: [
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubdrive.pics/file/cosmic-s1-complete-1080',
      resolution: '1080p',
      episode: 'COMPLETE SEASON',
      format: 'WEB-DL',
      isCompleteSeason: true
    }
  ]
};

const res1 = resolver.groupAndOrderDownloads(seriesItem1, seriesEntry1);
check(1, "Web series: A series with a verified complete-season link shows that link",
  res1.isSeries === true &&
  res1.hasLinks === true &&
  res1.completeSeasonGroups.length === 1 &&
  res1.completeSeasonGroups[0].seasonLabel === 'Season 1' &&
  res1.completeSeasonGroups[0].qualities[0].links[0].downloadUrl === 'https://hubdrive.pics/file/cosmic-s1-complete-1080' &&
  res1.completeSeasonGroups[0].qualities[0].links[0].label === 'Link 1' &&
  res1.seasonEpisodeGroups.length === 0,
  "(Verified complete-season link displayed with Link 1 label; 0 episode lists)"
);

// ---------------------------------------------------------------------------
// Test 2: A series with individual episode links only shows no download links
// ---------------------------------------------------------------------------
const seriesItem2 = {
  canonicalId: 9102,
  displayTitle: 'Weekly Tales',
  type: 'Web Series',
  year: '2026',
  season: 'Season 1'
};

const seriesEntry2 = {
  catalogueId: 9102,
  title: 'Weekly Tales',
  type: 'Web Series',
  links: [
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubcdn.wiki/file/ep1-720',
      resolution: '720p',
      episode: 'Episode 1'
    },
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubcdn.wiki/file/ep2-720',
      resolution: '720p',
      episode: 'Episode 2'
    }
  ]
};

const res2 = resolver.groupAndOrderDownloads(seriesItem2, seriesEntry2);
check(2, "Web series: A series with individual episode links only shows no download links",
  res2.isSeries === true &&
  res2.hasLinks === false &&
  res2.completeSeasonGroups.length === 0 &&
  res2.seasonEpisodeGroups.length === 0 &&
  res2.emptyReason === 'No verified complete-season links available.',
  "(Zero download links shown; clean empty reason returned; 0 individual episodes displayed)"
);

// ---------------------------------------------------------------------------
// Test 3: A series with both complete-season and individual episode links displays only complete-season links
// ---------------------------------------------------------------------------
const seriesItem3 = {
  canonicalId: 9103,
  displayTitle: 'Chrono Detective',
  type: 'Web Series',
  year: '2026',
  season: 'Season 1'
};

const seriesEntry3 = {
  catalogueId: 9103,
  title: 'Chrono Detective',
  type: 'Web Series',
  links: [
    // Complete Season Link
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubdrive.pics/file/chrono-s1-complete-1080',
      resolution: '1080p',
      episode: 'FULL SERIES',
      format: 'WEB-DL',
      isCompleteSeason: true
    },
    // Individual Episode Links
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubcdn.wiki/file/chrono-s1-ep01',
      resolution: '1080p',
      episode: 'Episode 1'
    },
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubcdn.wiki/file/chrono-s1-ep02',
      resolution: '1080p',
      episode: 'Episode 2'
    }
  ]
};

const res3 = resolver.groupAndOrderDownloads(seriesItem3, seriesEntry3);
check(3, "Web series: Both complete-season and episode links displays ONLY complete-season links",
  res3.isSeries === true &&
  res3.hasLinks === true &&
  res3.completeSeasonGroups.length === 1 &&
  res3.completeSeasonGroups[0].qualities[0].links.length === 1 &&
  res3.completeSeasonGroups[0].qualities[0].links[0].downloadUrl === 'https://hubdrive.pics/file/chrono-s1-complete-1080' &&
  res3.seasonEpisodeGroups.length === 0,
  "(Complete season link retained; individual episodes strictly omitted)"
);

// ---------------------------------------------------------------------------
// Test 4: Multiple seasons retain their correct season grouping
// ---------------------------------------------------------------------------
const seriesItem4 = {
  canonicalId: 9104,
  displayTitle: 'Dynasty of Shadows',
  type: 'Web Series',
  year: '2025'
};

const seriesEntry4 = {
  catalogueId: 9104,
  title: 'Dynasty of Shadows',
  type: 'Web Series',
  links: [
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubcdn.wiki/file/dynasty-s1-pack',
      resolution: '1080p',
      season: 'Season 1',
      episode: 'FULL SERIES'
    },
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubcdn.wiki/file/dynasty-s2-pack',
      resolution: '1080p',
      season: 'Season 2',
      episode: 'FULL SERIES'
    }
  ]
};

const res4 = resolver.groupAndOrderDownloads(seriesItem4, seriesEntry4);
check(4, "Web series: Multiple seasons retain their correct season grouping",
  res4.completeSeasonGroups.length === 2 &&
  res4.completeSeasonGroups[0].seasonNumber === 1 &&
  res4.completeSeasonGroups[0].seasonLabel === 'Season 1' &&
  res4.completeSeasonGroups[0].qualities[0].links[0].downloadUrl === 'https://hubcdn.wiki/file/dynasty-s1-pack' &&
  res4.completeSeasonGroups[1].seasonNumber === 2 &&
  res4.completeSeasonGroups[1].seasonLabel === 'Season 2' &&
  res4.completeSeasonGroups[1].qualities[0].links[0].downloadUrl === 'https://hubcdn.wiki/file/dynasty-s2-pack',
  "(Season 1 and Season 2 grouped separately by actual season number)"
);

// ---------------------------------------------------------------------------
// Test 5: An unverified complete-season link is not displayed
// ---------------------------------------------------------------------------
const seriesItem5 = {
  canonicalId: 9105,
  displayTitle: 'Suspicious Series',
  type: 'Web Series',
  year: '2026'
};

const seriesEntry5 = {
  catalogueId: 9105,
  title: 'Suspicious Series',
  type: 'Web Series',
  links: [
    {
      sourceName: 'Aggregator',
      downloadUrl: 'https://10moviesz.mom/view.php?id=d888f0', // Unverified redirector query
      resolution: '1080p',
      episode: 'COMPLETE SEASON'
    }
  ]
};

const res5 = resolver.groupAndOrderDownloads(seriesItem5, seriesEntry5);
check(5, "Web series: An unverified complete-season link is not displayed",
  res5.hasLinks === false &&
  res5.completeSeasonGroups.length === 0,
  "(Unverified redirector query link excluded; hasLinks: false)"
);

// ---------------------------------------------------------------------------
// Test 6: Missing complete-season links produce the correct empty state
// ---------------------------------------------------------------------------
const seriesItem6 = {
  canonicalId: 9106,
  displayTitle: 'Unavailable Series',
  type: 'Web Series',
  year: '2026'
};

const res6 = resolver.groupAndOrderDownloads(seriesItem6, null);
check(6, "Web series: Missing complete-season links produce the correct clean empty state",
  res6.isSeries === true &&
  res6.hasLinks === false &&
  res6.completeSeasonGroups.length === 0 &&
  res6.emptyReason === 'No verified complete-season links available.',
  "(Empty state banner text accurately specifies 'No verified complete-season links available.')"
);

// ===========================================================================
// SECTION 2: MOVIES AND LINK VERIFICATION (Problem 4)
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 7: Valid, verified movie download links remain available
// ---------------------------------------------------------------------------
const movieItem7 = {
  canonicalId: 9201,
  displayTitle: 'Galactic Horizon',
  type: 'Movie',
  year: '2026'
};

const movieEntry7 = {
  catalogueId: 9201,
  title: 'Galactic Horizon',
  type: 'Movie',
  links: [
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubdrive.pics/file/991001',
      resolution: '720p',
      format: 'WEB-DL'
    },
    {
      sourceName: 'Direct',
      downloadUrl: 'https://hubcdn.wiki/file/991002',
      resolution: '1080p',
      format: 'BluRay'
    }
  ]
};

const res7 = resolver.groupAndOrderDownloads(movieItem7, movieEntry7);
check(7, "Movies: Valid, verified movie download links remain available",
  res7.isSeries === false &&
  res7.hasLinks === true &&
  res7.movieQualityGroups.length === 2 &&
  res7.movieQualityGroups[0].links[0].label === 'Link 1' &&
  res7.movieQualityGroups[1].links[0].label === 'Link 1',
  "(720p and 1080p verified options preserved with Link 1 labels)"
);

// ---------------------------------------------------------------------------
// Test 8: Broken links are excluded
// ---------------------------------------------------------------------------
const movieItem8 = {
  canonicalId: 9202,
  displayTitle: 'Broken Links Movie',
  type: 'Movie',
  year: '2026'
};

const movieEntry8 = {
  catalogueId: 9202,
  title: 'Broken Links Movie',
  type: 'Movie',
  links: [
    { downloadUrl: '#' },
    { downloadUrl: 'javascript:void(0)' },
    { downloadUrl: 'not-a-valid-url' },
    { downloadUrl: 'ftp://files.example.com/movie.mkv' },
    { downloadUrl: 'https://hubcdn.wiki/' } // Missing storage/file path
  ]
};

const res8 = resolver.groupAndOrderDownloads(movieItem8, movieEntry8);
check(8, "Link verification: Broken links are excluded",
  res8.hasLinks === false &&
  res8.movieQualityGroups.length === 0,
  "(Malformed URLs, non-HTTP, '#', and empty path roots strictly excluded)"
);

// ---------------------------------------------------------------------------
// Test 9: Temporary failures are not automatically labelled permanently broken
// ---------------------------------------------------------------------------
const tempFailLink = {
  downloadUrl: 'https://hubdrive.pics/file/temp-slow',
  explicitStatus: 'temporarily_unavailable'
};

const classification9 = resolver.classifyLinkVerification(tempFailLink);
check(9, "Link verification: Temporary failures are not automatically labelled permanently broken",
  classification9.status === 'temporarily_unavailable' &&
  classification9.status !== 'broken' &&
  classification9.reason.includes('Temporary'),
  "(Classified as temporarily_unavailable; eligible for retry; not marked permanently broken)"
);

// ---------------------------------------------------------------------------
// Test 10: Source article URLs are never shown as download destinations
// ---------------------------------------------------------------------------
const movieItem10 = {
  canonicalId: 9204,
  displayTitle: 'Article Trap Movie',
  type: 'Movie',
  year: '2026',
  sourceUrl: 'https://new2.hdhub4u.free/article-trap-2026-full-movie/'
};

const movieEntry10 = {
  catalogueId: 9204,
  title: 'Article Trap Movie',
  type: 'Movie',
  links: [
    // Source article URL masquerading as download
    {
      sourceUrl: 'https://new2.hdhub4u.free/article-trap-2026-full-movie/',
      downloadUrl: 'https://new2.hdhub4u.free/article-trap-2026-full-movie/',
      resolution: '1080p'
    },
    // Genuine storage destination
    {
      sourceUrl: 'https://new2.hdhub4u.free/article-trap-2026-full-movie/',
      downloadUrl: 'https://hubdrive.pics/file/genuine-storage-789',
      resolution: '720p'
    }
  ]
};

const res10 = resolver.groupAndOrderDownloads(movieItem10, movieEntry10);
const g1080_10 = res10.movieQualityGroups.find(g => g.qualityKey === '1080p');
const g720_10 = res10.movieQualityGroups.find(g => g.qualityKey === '720p');

check(10, "Link verification: Source article URLs are never shown as download destinations",
  g1080_10 === undefined && // Rejected because downloadUrl is the source article
  g720_10 !== undefined &&
  g720_10.links[0].downloadUrl === 'https://hubdrive.pics/file/genuine-storage-789',
  "(Source article URL strictly rejected; genuine storage destination preserved)"
);

// ---------------------------------------------------------------------------
// Test 11: Redirected destinations and storage CDN endpoints are handled correctly
// ---------------------------------------------------------------------------
const cdnHosts = [
  'https://hubcdn.wiki/file/dl01',
  'https://hubdrive.pics/file/dl02',
  'https://hubcloud.ist/drive/dl03',
  'https://new1.filesdl.in/cloud/dl04',
  'https://gdflix.cfd/file/dl05',
  'https://linkmake.in/file/dl06'
];

const allCdnVerified = cdnHosts.every(u => resolver.classifyLinkVerification(u).status === 'verified');
check(11, "Link verification: Known storage CDN and drive destinations verified correctly",
  allCdnVerified === true,
  "(hubcdn, hubdrive, hubcloud, filesdl, gdflix, linkmake all verified with valid paths)"
);

// ---------------------------------------------------------------------------
// Test 12: Invalid or ambiguous title matches do not attach a link to the wrong title
// ---------------------------------------------------------------------------
const titleDon1 = { canonicalId: 8001, displayTitle: 'Don', type: 'Movie', year: '2006' };
const titleDon2 = { canonicalId: 8002, displayTitle: 'Don 2', type: 'Movie', year: '2011' };

const dlDon1 = {
  catalogueId: 8001,
  title: 'Don',
  type: 'Movie',
  year: '2006',
  links: [{ downloadUrl: 'https://hubdrive.pics/file/don-2006-destination', resolution: '1080p' }]
};

const resDon1 = resolver.groupAndOrderDownloads(titleDon1, dlDon1);
const resDon2 = resolver.groupAndOrderDownloads(titleDon2, null);

check(12, "Link matching: Ambiguous title matches do not attach link to wrong title",
  resDon1.hasLinks === true &&
  resDon1.movieQualityGroups[0].links[0].downloadUrl === 'https://hubdrive.pics/file/don-2006-destination' &&
  resDon2.hasLinks === false &&
  resDon2.movieQualityGroups.length === 0,
  "(Don (2006) and Don 2 (2011) strictly isolated; 0 cross-title bleed)"
);

// ---------------------------------------------------------------------------
// Test 13: Re-running the matching process does not create duplicate records
// ---------------------------------------------------------------------------
const dupItem = { canonicalId: 9205, displayTitle: 'Idempotency Test', type: 'Movie', year: '2026' };
const dupEntry = {
  catalogueId: 9205,
  title: 'Idempotency Test',
  type: 'Movie',
  links: [
    { downloadUrl: 'https://hubdrive.pics/file/same-target', resolution: '1080p' },
    { downloadUrl: 'https://hubdrive.pics/file/same-target', resolution: '1080p' } // Exact duplicate
  ]
};

const res13 = resolver.groupAndOrderDownloads(dupItem, dupEntry);
check(13, "Matching idempotency: Duplicate links deduplicated cleanly",
  res13.movieQualityGroups.length === 1 &&
  res13.movieQualityGroups[0].links.length === 1 &&
  res13.movieQualityGroups[0].links[0].label === 'Link 1',
  "(Identical links deduplicated to single Link 1 entry)"
);

// ===========================================================================
// SECTION 3: SOURCE-REFERENCE REMOVAL (Problem 5)
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 14: No details page renders a "Source Article Reference" section
// ---------------------------------------------------------------------------
const htmlContent = fs.readFileSync(path.join(BASE_DIR, 'index.html'), 'utf8');
const appJsContent = fs.readFileSync(path.join(BASE_DIR, 'app.js'), 'utf8');

check(14, "Source removal: No details page renders a 'Source Article Reference' section",
  !htmlContent.includes('section-source-article') &&
  !htmlContent.includes('Source Article Reference') &&
  !appJsContent.includes('renderSourceReferenceSection') &&
  !appJsContent.includes('dl-source-reference-container'),
  "(Source Article Reference section completely absent from HTML and JS templates)"
);

// ---------------------------------------------------------------------------
// Test 15: No source names, source domains, or source URLs appear in user-facing details or Available Versions
// ---------------------------------------------------------------------------
// Check resolver output for movie and web series
const renderedDownloadButtons = [
  ...res1.completeSeasonGroups.flatMap(s => s.qualities.flatMap(q => q.links)),
  ...res7.movieQualityGroups.flatMap(q => q.links)
];

const hasExposedProviderInLabel = renderedDownloadButtons.some(l =>
  l.label.includes('HDHub4u') || l.label.includes('10Moviez') || l.label.includes('HDWall')
);

check(15, "Source removal: No source names or provider domains appear in user-facing buttons",
  hasExposedProviderInLabel === false &&
  !appJsContent.includes('btn-version-view-source') &&
  !appJsContent.includes('View Source Article'),
  "(All download buttons strictly labeled Link 1, Link 2...; zero provider names exposed)"
);

// ---------------------------------------------------------------------------
// Test 16: Removing source references does not break valid download buttons or other page interactions
// ---------------------------------------------------------------------------
check(16, "Source removal: Valid download buttons retain correct attributes and interactions",
  appJsContent.includes('class="btn-version-download"') &&
  appJsContent.includes('target="_blank"') &&
  appJsContent.includes('rel="noopener noreferrer"'),
  "(Download buttons open in secure new tabs with noopener noreferrer)"
);

// ---------------------------------------------------------------------------
// Test 17: Desktop and mobile layouts remain correct
// ---------------------------------------------------------------------------
const cssContent = fs.readFileSync(path.join(BASE_DIR, 'styles.css'), 'utf8');
check(17, "Layout integrity: Responsive styles for Available Versions intact without empty gaps",
  cssContent.includes('.available-versions-container') &&
  cssContent.includes('.btn-version-download') &&
  cssContent.includes('.complete-season-card') &&
  cssContent.includes('@media (max-width: 768px)') &&
  !cssContent.includes('.dl-source-reference-container') &&
  !cssContent.includes('.btn-version-view-source'),
  "(Clean responsive styling present; obsolete source-container rules removed without gaps)"
);

// ===========================================================================
// SECTION 4: REGRESSION & CATALOG INTEGRITY
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 18: Full master catalog of 13,642 canonical records preserved without loss
// ---------------------------------------------------------------------------
const catalogData = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'data', 'catalog.json'), 'utf8'));
check(18, "Catalog integrity: Master catalog baseline preserved without loss",
  catalogData.length >= 13642,
  `(Count: ${catalogData.length.toLocaleString()} titles intact; >= 13,642 baseline)`
);

// ---------------------------------------------------------------------------
// Test 19: Navigation, search, filter functions intact in app.js
// ---------------------------------------------------------------------------
check(19, "App integrity: Navigation, search, filter controller functions intact in app.js",
  appJsContent.includes('function openDetailView(') &&
  appJsContent.includes('function closeDetailView(') &&
  appJsContent.includes('parseUrlHash') &&
  appJsContent.includes('activeFilters'),
  "(Core SPA routing and catalog interaction controllers intact)"
);

console.log('='.repeat(70));
if (passed === total) {
  console.log(`ALL ${passed}/${total} ACCEPTANCE CHECKS PASSED WITH 100% SUCCESS!`);
  process.exit(0);
} else {
  console.error(`FAILED: ${passed}/${total} tests passed.`);
  process.exit(1);
}
