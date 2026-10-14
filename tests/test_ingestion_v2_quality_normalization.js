/**
 * PRAFLIX — Acceptance & Regression Suite: Quality Normalization Fallback & Evidence Hierarchy
 * A PRAVERSE Company
 *
 * Covers:
 * 1. Explicit 2160p, 1080p, 720p, and 480p labels correctly map to canonical resolutions.
 * 2. Generic labels ("Download", "Download Trailer", "Full Movie", "Drive") do NOT default to 720p.
 * 3. Authorized file metadata (probe result / payload title / filename) provides true resolution.
 * 4. Conflicting source labels and file metadata are detected, preferring verified payload while preserving original source label.
 * 5. Missing or failed metadata probes gracefully fall back to explicit label, or mark as unknown (never 720p).
 * 6. Unambiguous context (single resolution in heading) disambiguates, while multi-resolution context avoids false attribution.
 * 7. End-to-end adapter, normalizer, and destination_resolver integration.
 */

const assert = require('assert');
const path = require('path');
const { BaseV2Adapter } = require('../ingestion_v2/adapters/base_v2_adapter');
const { HDHub4uV2Adapter } = require('../ingestion_v2/adapters/hdhub4u_v2_adapter');
const { Normalizer } = require('../ingestion_v2/normalization/normalizer');
const resolver = require('../destination_resolver');

console.log('='.repeat(70));
console.log('PRAFLIX INGESTION V2: QUALITY NORMALIZATION & EVIDENCE HIERARCHY');
console.log('='.repeat(70));

const adapter = new BaseV2Adapter({
  id: 'test',
  displayName: 'Test Adapter',
  baseUrl: 'https://example.com/'
});

let totalChecks = 0;
let passedChecks = 0;

function check(name, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✓ ${name} ${details}`);
  } else {
    console.error(`  ✗ FAILED: ${name} ${details}`);
    assert.ok(condition, name);
  }
}

// ===========================================================================
// SECTION 1: EXPLICIT RESOLUTION LABELS
// ===========================================================================
console.log('\n[Section 1] Explicit 2160p, 1080p, 720p, and 480p labels...');

// 4K / 2160p
check('Explicit 4K uppercase', adapter.normalizeQuality('4K') === '4K');
check('Explicit 2160p', adapter.normalizeQuality('2160p') === '4K');
check('Explicit 4K bracketed with codec & size', adapter.normalizeQuality('4K [2160p SDR WEB-DL – 10.5GB]') === '4K');
check('Explicit UHD', adapter.normalizeQuality('2160p UHD') === '4K');

// 1080p
check('Explicit 1080p', adapter.normalizeQuality('1080p') === '1080p');
check('Explicit 1080p with codec', adapter.normalizeQuality('1080p HEVC [2GB]') === '1080p');
check('Explicit Full HD', adapter.normalizeQuality('Full HD 1080p') === '1080p');
check('Explicit FHD', adapter.normalizeQuality('FHD WEB-DL [3.6GB]') === '1080p');
check('Explicit 1080p high bitrate', adapter.normalizeQuality('1080p WEB-DL [9.7GB]') === '1080p');

// 720p
check('Explicit 720p', adapter.normalizeQuality('720p') === '720p');
check('Explicit 720p with codec', adapter.normalizeQuality('720p HEVC [940MB]') === '720p');
check('Explicit 720p x264', adapter.normalizeQuality('720p x264 [1.4GB]') === '720p');
check('Explicit 720p HD', adapter.normalizeQuality('720p HD') === '720p');

// 480p
check('Explicit 480p', adapter.normalizeQuality('480p') === '480p');
check('Explicit 480p with size', adapter.normalizeQuality('480p [560MB]') === '480p');
check('Explicit SD 480p', adapter.normalizeQuality('SD 480p') === '480p');

// 360p
check('Explicit 360p', adapter.normalizeQuality('360p') === '360p');

// ===========================================================================
// SECTION 2: GENERIC LABELS DO NOT ASSUME 720p
// ===========================================================================
console.log('\n[Section 2] Generic labels do NOT fabricate 720p...');

const genericLabels = [
  'Download',
  'Download Trailer',
  '[Download Trailer]',
  'Full Movie',
  'Drive',
  'Watch Online',
  'Click Here',
  'Server 1',
  '',
  null,
  undefined
];

for (const label of genericLabels) {
  const res = adapter.normalizeQuality(label);
  check(`Generic label "${label}" maps to "unknown"`, res === 'unknown');
  check(`Generic label "${label}" does NOT assume "720p"`, res !== '720p');
}

// ===========================================================================
// SECTION 3: AUTHORIZED FILE METADATA RESOLUTION
// ===========================================================================
console.log('\n[Section 3] Authorized file metadata resolves true resolution...');

// Case: Weapons trailer generic anchor text + HubDrive file title probe
const weaponsDetailed = adapter.resolveQualityDetailed({
  rawLabel: '[Download Trailer]',
  fileMetadata: {
    title: 'HubDrive | WEAPONS-2025-HQ-1080p-Hindi-Dubbed-Trailer-HDHub4u.Ag.mkv',
    filename: 'WEAPONS-2025-HQ-1080p-Hindi-Dubbed-Trailer-HDHub4u.Ag.mkv',
    sizeBytes: 193450000
  }
});
check('Weapons trailer resolves to 1080p via file metadata', weaponsDetailed.resolution === '1080p');
check('Weapons sourceLabel preserved as "[Download Trailer]"', weaponsDetailed.sourceLabel === '[Download Trailer]');
check('Weapons resolution source is filename_metadata', weaponsDetailed.resolutionSource === 'filename_metadata');
check('Weapons has no conflict (label was generic)', weaponsDetailed.hasConflict === false);

// Case: 4K Movie generic anchor text + file filename probe
const movie4kDetailed = adapter.resolveQualityDetailed({
  rawLabel: 'Full Movie',
  fileMetadata: {
    filename: 'Pushpa.2.The.Rule.2024.4K.2160p.UHD.HEVC.mkv'
  }
});
check('Generic "Full Movie" resolves to 4K via filename probe', movie4kDetailed.resolution === '4K');
check('Source label preserved as "Full Movie"', movie4kDetailed.sourceLabel === 'Full Movie');

// Case: File metadata via numeric video height
const heightDetailed = adapter.resolveQualityDetailed({
  rawLabel: 'Download',
  fileMetadata: { height: 1080 }
});
check('Height 1080 resolves to 1080p', heightDetailed.resolution === '1080p');

// ===========================================================================
// SECTION 4: CONFLICTING SOURCE LABELS AND FILE METADATA
// ===========================================================================
console.log('\n[Section 4] Conflicting source labels and file metadata...');

// Conflict: Source anchor text says 720p, but file on CDN is 1080p
const conflict1 = adapter.resolveQualityDetailed({
  rawLabel: '720p HEVC [1.2GB]',
  fileMetadata: {
    filename: 'Movie.2025.1080p.WEB-DL.x264.mkv'
  }
});
check('Conflict 1: Verified file metadata overrides source typo (1080p)', conflict1.resolution === '1080p');
check('Conflict 1: hasConflict flag is true', conflict1.hasConflict === true);
check('Conflict 1: Preserves original source label separately', conflict1.sourceLabel === '720p HEVC [1.2GB]');
check('Conflict 1: Records fileResolution', conflict1.fileResolution === '1080p');
check('Conflict 1: Records labelResolution', conflict1.labelResolution === '720p');

// Conflict: Source anchor text says 1080p, but file on CDN is 720p
const conflict2 = adapter.resolveQualityDetailed({
  rawLabel: '1080p Full HD',
  fileMetadata: {
    filename: 'Movie.2025.720p.WEB-DL.mkv'
  }
});
check('Conflict 2: Verified file metadata overrides source typo (720p)', conflict2.resolution === '720p');
check('Conflict 2: hasConflict flag is true', conflict2.hasConflict === true);
check('Conflict 2: Preserves original source label separately', conflict2.sourceLabel === '1080p Full HD');

// Agreement: Source and file metadata agree
const agreement = adapter.resolveQualityDetailed({
  rawLabel: '1080p HEVC [2GB]',
  fileMetadata: {
    filename: 'Ratsasan.2018.UNCUT.1080p.HEVC.mkv'
  }
});
check('Agreement: Resolution matches (1080p)', agreement.resolution === '1080p');
check('Agreement: hasConflict is false', agreement.hasConflict === false);
check('Agreement: source is filename_metadata_confirmed', agreement.source === 'filename_metadata_confirmed');

// ===========================================================================
// SECTION 5: MISSING OR FAILED METADATA PROBES
// ===========================================================================
console.log('\n[Section 5] Missing or failed metadata probes...');

// Explicit source label + missing probe -> explicit label wins
const missingProbeExplicit = adapter.resolveQualityDetailed({
  rawLabel: '1080p HEVC [2GB]',
  fileMetadata: null
});
check('Explicit label + missing probe uses explicit label', missingProbeExplicit.resolution === '1080p');
check('Source is explicit_source_label', missingProbeExplicit.source === 'explicit_source_label');

// Explicit source label + failed probe -> explicit label wins
const failedProbeExplicit = adapter.resolveQualityDetailed({
  rawLabel: '4K [2160p]',
  fileMetadata: { status: 'failed' },
  probeFailed: true
});
check('Explicit label + failed probe uses explicit label', failedProbeExplicit.resolution === '4K');
check('Source is explicit_source_label', failedProbeExplicit.source === 'explicit_source_label');

// Generic label + missing probe -> unknown (never 720p)
const missingProbeGeneric = adapter.resolveQualityDetailed({
  rawLabel: 'Download Trailer',
  fileMetadata: null
});
check('Generic label + missing probe returns unknown', missingProbeGeneric.resolution === 'unknown');
check('Generic label + missing probe does NOT return 720p', missingProbeGeneric.resolution !== '720p');

// Generic label + failed probe -> unknown (never 720p)
const failedProbeGeneric = adapter.resolveQualityDetailed({
  rawLabel: '[Download Trailer]',
  probeFailed: true
});
check('Generic label + failed probe returns unknown', failedProbeGeneric.resolution === 'unknown');
check('Generic label + failed probe does NOT return 720p', failedProbeGeneric.resolution !== '720p');

// ===========================================================================
// SECTION 6: UNAMBIGUOUS VS AMBIGUOUS CONTEXT
// ===========================================================================
console.log('\n[Section 6] Unambiguous vs ambiguous context...');

// Single resolution in heading -> disambiguates generic label
const singleContext = adapter.resolveQualityDetailed({
  rawLabel: '[Download Trailer]',
  fallbackContext: 'WEAPONS (2025) [1080p Trailer] – Horror/Thriller'
});
check('Single-resolution context disambiguates generic button', singleContext.resolution === '1080p');
check('Source is unambiguous_context', singleContext.source === 'unambiguous_context');

// Multi-resolution in heading -> ambiguous, must NOT guess or assume
const multiContext = adapter.resolveQualityDetailed({
  rawLabel: 'Download',
  fallbackContext: 'Ratsasan (2018) UNCUT WEB-DL [Hindi & Tamil] 1080p 720p & 480p Dual Audio'
});
check('Multi-resolution context does NOT fabricate quality for generic button', multiContext.resolution === 'unknown');
check('Multi-resolution context does NOT return 720p', multiContext.resolution !== '720p');

// ===========================================================================
// SECTION 7: END-TO-END ADAPTER & NORMALIZER INTEGRATION
// ===========================================================================
console.log('\n[Section 7] End-to-end adapter and normalizer integration...');

const hdhubAdapter = new HDHub4uV2Adapter();

// Link with generic label and no probe -> validated with unknown quality
const validGenericLink = hdhubAdapter.validateLink({
  downloadUrl: 'https://hubdrive.pics/file/999999999',
  rawQuality: '[Download Trailer]',
  type: 'Movie'
}, 'https://new7.hdhub4u.cl/weapons-2025-trailer/');
check('Valid link with generic label is verified', validGenericLink.isValid === true);
check('Valid link with generic label has resolution "unknown"', validGenericLink.resolution === 'unknown');
check('Valid link preserves sourceLabel separately', validGenericLink.sourceLabel === '[Download Trailer]');

// Normalizer preserves unknown without fabricating 720p
const normalizer = new Normalizer();
const normalized = normalizer.normalizeRecord({
  provider: 'HDHub4u',
  originalSourceTitle: 'Unknown Quality Film (2025)',
  sourceUrl: 'https://example.com/film/',
  downloadLinks: [
    { quality: 'unknown', url: 'https://hubdrive.pics/file/999', rawQuality: 'Download' }
  ]
});
check('Normalizer sets qualities to ["unknown"] for unknown links', normalized.qualities.length === 1 && normalized.qualities[0] === 'unknown');
check('Normalizer does NOT add "720p"', !normalized.qualities.includes('720p'));

// ===========================================================================
// SECTION 8: DESTINATION RESOLVER RENDERING FOR UNKNOWN QUALITY
// ===========================================================================
console.log('\n[Section 8] Destination resolver rendering for unknown quality...');

const mockMovie = {
  canonicalId: 99999,
  displayTitle: 'Pending Verification Film',
  type: 'Movie',
  sourceUrl: 'https://example.com/pending/'
};
const mockDownloads = {
  catalogueId: 99999,
  links: [
    {
      sourceName: 'hdhub4u',
      downloadUrl: 'https://hubdrive.pics/file/888888',
      resolution: 'unknown',
      rawQuality: '[Download Trailer]',
      verificationStatus: 'verified'
    }
  ]
};

const resolvedModel = resolver.groupAndOrderDownloads(mockMovie, mockDownloads);
check('Destination resolver handles unknown quality', resolvedModel.hasLinks === true);
check('Quality key is "unknown"', resolvedModel.movieQualityGroups[0].qualityKey === 'unknown');
check('Display label is "Quality Pending Verification"', resolvedModel.movieQualityGroups[0].label === 'Quality Pending Verification');
check('CSS class is "res-unknown"', resolvedModel.movieQualityGroups[0].resCls === 'res-unknown');
check('Link is preserved in group', resolvedModel.movieQualityGroups[0].links[0].downloadUrl === 'https://hubdrive.pics/file/888888');

console.log('='.repeat(70));
console.log(`ALL ${passedChecks}/${totalChecks} QUALITY NORMALIZATION CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
