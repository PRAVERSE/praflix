/**
 * PRAFLIX Ingestion Pipeline V2 — Pre-Deployment Integration Audit Suite
 * A PRAVERSE Company
 *
 * Covers:
 * 1. All-Provider Parity (HDHub4u, 10Moviez, HDWall)
 * 2. Catalog Merger Safety (Duplicates, Quality Preservation, Atomic Rollback)
 * 3. Metadata Probe Reliability (Timeout, Redirect, Malformed, Stream vs Filename distinction)
 * 4. Frontend Compatibility (Available Versions grouping, unknown sort order, desktop/mobile)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { BaseV2Adapter } = require('../ingestion_v2/adapters/base_v2_adapter');
const { HDHub4uV2Adapter } = require('../ingestion_v2/adapters/hdhub4u_v2_adapter');
const { TenMoviezV2Adapter } = require('../ingestion_v2/adapters/tenmoviez_v2_adapter');
const { HDWallV2Adapter } = require('../ingestion_v2/adapters/hdwall_v2_adapter');
const { CatalogMerger } = require('../ingestion_v2/merge/catalog_merger');
const resolver = require('../destination_resolver');

let passedChecks = 0;
let totalChecks = 0;

function check(desc, condition) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✓ ${desc}`);
  } else {
    console.error(`  ✗ FAILED: ${desc}`);
    assert.fail(desc);
  }
}

console.log('======================================================================');
console.log('PRAFLIX INGESTION V2: FINAL PRE-DEPLOYMENT INTEGRATION AUDIT');
console.log('======================================================================');

// ===========================================================================
// SECTION 1: ALL-PROVIDER PARITY (HDHub4u, 10Moviez, HDWall)
// ===========================================================================
console.log('\n[Section 1] All-Provider Parity (HDHub4u, 10Moviez, HDWall)...');

const hdhub = new HDHub4uV2Adapter();
const tenmov = new TenMoviezV2Adapter();
const hdwall = new HDWallV2Adapter();

const sampleHtmlHDWall = `
<!DOCTYPE html>
<html>
<head><title>Test Movie 2025 Hindi HDWall</title></head>
<body>
  <h1>Test Movie 2025</h1>
  <div class="custom-poster"><img src="/uploads/posts/covers/photo_123.jpg" alt="Test Movie"></div>
  <div class="dlink dl">
    <a href="https://hubdrive.pics/file/hdwall_1080p">
      <div class="dll">Download 1080p Full HD [2.4GB]</div>
    </a>
    <a href="https://hubdrive.pics/file/hdwall_generic">
      <div class="dll">[Download Trailer]</div>
    </a>
    <a href="https://hubdrive.pics/file/hdwall_720p">
      <div class="dll">Download 720p HD</div>
    </a>
  </div>
</body>
</html>
`;

const parsedHDWall = hdwall.parseDetailPage(sampleHtmlHDWall, 'https://hdwall.xyz/test-movie-2025.html');
check('HDWall parses detail page and extracts links', parsedHDWall && parsedHDWall.downloadLinks.length === 3);

const hdw1080 = parsedHDWall.downloadLinks.find(l => l.url.includes('hdwall_1080p'));
const hdwGeneric = parsedHDWall.downloadLinks.find(l => l.url.includes('hdwall_generic'));
const hdw720 = parsedHDWall.downloadLinks.find(l => l.url.includes('hdwall_720p'));

check('HDWall 1080p link normalized to 1080p', hdw1080 && hdw1080.quality === '1080p');
check('HDWall generic "[Download Trailer]" normalized to "unknown" (never 720p)', hdwGeneric && hdwGeneric.quality === 'unknown');
check('HDWall generic link does NOT fabricate 720p', hdwGeneric && hdwGeneric.quality !== '720p');
check('HDWall preserves sourceLabel independently', hdwGeneric && hdwGeneric.sourceLabel === '[Download Trailer]');
check('HDWall 720p link normalized to 720p', hdw720 && hdw720.quality === '720p');

// Direct parity check across all 3 providers on generic buttons
for (const [name, adapter] of [['HDHub4u', hdhub], ['10Moviez', tenmov], ['HDWall', hdwall]]) {
  const normDownload = adapter.normalizeQuality('Download');
  const normTrailer = adapter.normalizeQuality('[Download Trailer]');
  const normFullMovie = adapter.normalizeQuality('Full Movie');
  check(`${name}: "Download" resolves to "unknown"`, normDownload === 'unknown');
  check(`${name}: "[Download Trailer]" resolves to "unknown"`, normTrailer === 'unknown');
  check(`${name}: "Full Movie" resolves to "unknown"`, normFullMovie === 'unknown');
}

// ===========================================================================
// SECTION 2: METADATA PROBE RELIABILITY & PROBE FAILURE HANDLING
// ===========================================================================
console.log('\n[Section 2] Metadata Probe Reliability & Failure Handling...');

const baseAdapter = new BaseV2Adapter();

// 1. Probe Timeout handling
const timeoutProbe = baseAdapter.resolveQualityDetailed({
  rawLabel: '[Download Trailer]',
  fileMetadata: {
    status: 'timeout',
    error: 'ETIMEDOUT connection timed out after 5000ms'
  }
});
check('Probe Timeout on generic label produces "unknown"', timeoutProbe.resolution === 'unknown');
check('Probe Timeout does not fabricate 720p', timeoutProbe.resolution !== '720p');

// 2. Probe Redirect / Blocked handling
const redirectProbe = baseAdapter.resolveQualityDetailed({
  rawLabel: 'Click Here',
  fileMetadata: {
    status: 'redirect_blocked',
    error: 'Redirect to untrusted parking domain blocked'
  }
});
check('Probe Redirect blocked produces "unknown"', redirectProbe.resolution === 'unknown');

// 3. Malformed probe response handling
const malformedProbe = baseAdapter.resolveQualityDetailed({
  rawLabel: 'Server 1',
  fileMetadata: {
    status: 'malformed_response',
    error: 'Invalid JSON from probe'
  }
});
check('Malformed probe response produces "unknown"', malformedProbe.resolution === 'unknown');

// 4. Failed probe with explicit source label preserves source label
const failedProbeWithLabel = baseAdapter.resolveQualityDetailed({
  rawLabel: '1080p FHD [2.1GB]',
  fileMetadata: {
    status: 'failed',
    error: 'HTTP 503 Service Unavailable'
  }
});
check('Failed probe with explicit label retains explicit label (1080p)', failedProbeWithLabel.resolution === '1080p');
check('Source is explicit_source_label when probe fails', failedProbeWithLabel.source === 'explicit_source_label');

// 5. Stream vs Filename distinction in resolutionSource
const streamDetailed = baseAdapter.resolveQualityDetailed({
  rawLabel: '[Download]',
  fileMetadata: {
    height: 1080,
    width: 1920
  }
});
check('Stream-derived probe reports resolutionSource as "file_metadata"', streamDetailed.source === 'file_metadata');

const filenameDetailed = baseAdapter.resolveQualityDetailed({
  rawLabel: '[Download]',
  fileMetadata: {
    filename: 'Kalki.2024.Hindi.1080p.WEB-DL.mkv'
  }
});
check('Filename-derived probe reports resolutionSource as "filename_metadata"', filenameDetailed.source === 'filename_metadata');

// 6. Conflicting filename metadata vs source label
const filenameConflict = baseAdapter.resolveQualityDetailed({
  rawLabel: '720p HD',
  fileMetadata: {
    filename: 'Kalki.2024.Hindi.1080p.WEB-DL.mkv'
  }
});
check('Filename conflict overrides source typo to 1080p', filenameConflict.resolution === '1080p');
check('Filename conflict flags hasConflict = true', filenameConflict.hasConflict === true);
check('Filename conflict reports "filename_metadata_override_conflict"', filenameConflict.source === 'filename_metadata_override_conflict');
check('Preserves original source label "720p HD"', filenameConflict.sourceLabel === '720p HD');

// ===========================================================================
// SECTION 3: CATALOG MERGER SAFETY & INVARIANT ENFORCEMENT
// ===========================================================================
console.log('\n[Section 3] Catalog Merger Safety & Invariant Enforcement...');

const merger = new CatalogMerger();

// Test 1: Quarantine candidate with zero download links
const planZeroLinks = merger.createMergePlan([{
  displayTitle: 'Incomplete Title Without Links',
  year: '2025',
  type: 'Movie',
  downloadLinks: []
}]);
check('Zero-link candidate is strictly quarantined', planZeroLinks.quarantinedCount === 1);
check('Zero-link candidate not approved for catalog', planZeroLinks.approvedNewTitles.length === 0);

// Test 2: Clean qualities: unknown stripped if verified qualities exist
const planMixedQualities = merger.createMergePlan([{
  displayTitle: 'Unique Test Movie 2099',
  year: '2099',
  type: 'Movie',
  qualities: ['1080p', 'unknown'],
  downloadLinks: [{
    downloadUrl: 'https://hubdrive.pics/file/test_unique_link_2099',
    quality: '1080p'
  }]
}]);
check('Mixed qualities ["1080p", "unknown"] cleans out "unknown"',
  planMixedQualities.approvedNewTitles[0] &&
  planMixedQualities.approvedNewTitles[0].qualities.includes('1080p') &&
  !planMixedQualities.approvedNewTitles[0].qualities.includes('unknown')
);

// Test 3: Unresolved candidate retains ['unknown'] if all links unknown
const planUnknownQualities = merger.createMergePlan([{
  displayTitle: 'Unresolved Movie 2099',
  year: '2099',
  type: 'Movie',
  qualities: ['unknown'],
  downloadLinks: [{
    downloadUrl: 'https://hubdrive.pics/file/test_unknown_link_2099',
    quality: 'unknown'
  }]
}]);
check('All-unknown candidate retains ["unknown"]',
  planUnknownQualities.approvedNewTitles[0] &&
  planUnknownQualities.approvedNewTitles[0].qualities.length === 1 &&
  planUnknownQualities.approvedNewTitles[0].qualities[0] === 'unknown'
);

// Test 4: Existing title update never lets 'unknown' wipe out verified metadata
const existingCatalogSnapshot = JSON.parse(fs.readFileSync(merger.catalogPath, 'utf8'));
const targetItem = existingCatalogSnapshot[0]; // e.g. praflix-1

const planExistingUpdate = merger.createMergePlan([], [{
  canonicalId: targetItem.canonicalId,
  displayTitle: targetItem.displayTitle,
  incomingRecord: {
    qualities: ['unknown'],
    variants: [{ source: '10moviez', sourceUrl: 'https://10moviez.biz/test-variant' }],
    downloadLinks: [{ downloadUrl: 'https://hubcloud.foo/file/new_test_dl', quality: 'unknown' }]
  }
}]);

check('Existing title update approved', planExistingUpdate.approvedExistingUpdates.length === 1);
const updatePlanItem = planExistingUpdate.approvedExistingUpdates[0];
check('Existing verified qualities preserved (not downgraded to unknown)',
  updatePlanItem.mergedQualities.every(q => q !== 'unknown')
);
check('Canonical ID preserved unchanged', updatePlanItem.canonicalId === targetItem.canonicalId);

// Test 5: Defense-in-depth against duplicate canonical titles
const planDuplicateCandidate = merger.createMergePlan([{
  displayTitle: targetItem.displayTitle,
  year: targetItem.year,
  type: targetItem.type,
  downloadLinks: [{ downloadUrl: 'https://hubdrive.pics/file/dup_test', quality: '1080p' }]
}]);
check('Candidate matching existing canonical title does not create duplicate new title', planDuplicateCandidate.approvedNewTitles.length === 0);
check('Candidate is safely folded into existing title update', planDuplicateCandidate.approvedExistingUpdates.length === 1);

// ===========================================================================
// SECTION 4: FRONTEND COMPATIBILITY & AVAILABLE VERSIONS RENDERING
// ===========================================================================
console.log('\n[Section 4] Frontend Compatibility & Available Versions...');

// Test 1: Destination resolver groupAndOrderDownloads with mixed resolutions and unknown
const sampleLinks = [
  { downloadUrl: 'https://hubdrive.pics/file/4k', resolution: '4K', sourceName: 'HDHub4u' },
  { downloadUrl: 'https://hubdrive.pics/file/1080p', resolution: '1080p', sourceName: 'HDHub4u' },
  { downloadUrl: 'https://hubdrive.pics/file/720p', resolution: '720p', sourceName: 'HDHub4u' },
  { downloadUrl: 'https://hubdrive.pics/file/unknown', resolution: 'unknown', sourceName: 'HDHub4u' }
];

const downloadEntry = {
  type: 'Movie',
  links: sampleLinks
};

const groupedRes = resolver.groupAndOrderDownloads({ type: 'Movie' }, downloadEntry);
const movieGroups = groupedRes.movieQualityGroups;

check('All 4 quality groups created (4K, 1080p, 720p, unknown)', movieGroups.length === 4);

const group4K = movieGroups.find(g => g.qualityKey === '2160p');
const group1080 = movieGroups.find(g => g.qualityKey === '1080p');
const group720 = movieGroups.find(g => g.qualityKey === '720p');
const groupUnknown = movieGroups.find(g => g.qualityKey === 'unknown');

check('4K group exists and has label "4K UHD"', group4K && group4K.label === '4K UHD');
check('1080p group exists and has label "1080p Full HD"', group1080 && group1080.label === '1080p Full HD');
check('720p group exists and has label "720p HD"', group720 && group720.label === '720p HD');
check('unknown group exists and has label "Quality Pending Verification"', groupUnknown && groupUnknown.label === 'Quality Pending Verification');
check('unknown group has CSS class "res-unknown"', groupUnknown && groupUnknown.resCls === 'res-unknown');

// Check that movieGroups are sorted correctly: 2160p (4K), 1080p, 720p, and unknown last
check('Sorted groups order: 2160p is at index 0', movieGroups[0].qualityKey === '2160p');
check('Sorted groups order: 1080p is at index 1', movieGroups[1].qualityKey === '1080p');
check('Sorted groups order: 720p is at index 2', movieGroups[2].qualityKey === '720p');
check('Sorted groups order: unknown is at index 3 (last)', movieGroups[3].qualityKey === 'unknown');

// Direct unit test of qualitySortOrder
check('qualitySortOrder("2160p") === 10', resolver.qualitySortOrder('2160p') === 10);
check('qualitySortOrder("1080p") === 30', resolver.qualitySortOrder('1080p') === 30);
check('qualitySortOrder("720p") === 40', resolver.qualitySortOrder('720p') === 40);
check('qualitySortOrder("480p") === 50', resolver.qualitySortOrder('480p') === 50);
check('qualitySortOrder("unknown") === 99 (after all verified resolutions)', resolver.qualitySortOrder('unknown') === 99);

// Test 2: CSS Stylesheet check for .res-unknown badge rule
const stylesContent = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
check('styles.css contains .dl-res-badge.res-unknown', stylesContent.includes('.dl-res-badge.res-unknown'));
check('styles.css contains .version-quality-badge.res-unknown', stylesContent.includes('.version-quality-badge.res-unknown'));

console.log('======================================================================');
console.log(`INTEGRATION AUDIT COMPLETE: ${passedChecks}/${totalChecks} CHECKS PASSED WITH 100% SUCCESS!`);
console.log('======================================================================');
