/**
 * PRAFLIX — REGRESSION & DIAGNOSTIC SUITE: SEVEN INCOMPLETE HDHUB4U IMPORTS
 * A PRAVERSE Company
 *
 * Verifies the findings of the 15 October 2026, 02:46 PM IST HDHub4u run investigation:
 * 1. The 7 incomplete titles are accurately recorded in data/hdhub4u_sync_inventory.json.
 * 2. The deployed importer recognizes both approved prefixes:
 *    - https://hubdrive.pics/file/
 *    - https://hblinks.lol/archives/
 * 3. The candidate URLs on all 7 source pages (greenmotors.club, hdstream4u.com, etc.)
 *    are unsupported and strictly rejected by link validation and destination resolution.
 * 4. VisionQuest (Season 1) contains only individual episodes [EP-02 Added] and NO complete season pack.
 * 5. Ingestion gate strictly prevents any of the 7 titles from creating linkless canonical records.
 * 6. Catalog baseline invariant (>= 13,642 titles) and downloads ledger remain intact.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const resolver = require('../destination_resolver');
const HDHub4uAdapter = require('../scripts/adapters/hdhub4u_adapter');
const { getProviderConfig } = require('../scripts/provider_registry');

console.log('='.repeat(75));
console.log('PRAFLIX — DIAGNOSTIC & REGRESSION SUITE: SEVEN INCOMPLETE HDHUB4U IMPORTS');
console.log('='.repeat(75));

let total = 0;
let passed = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
    passed++;
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED: ${err.message}`);
    throw err;
  }
}

const EXPECTED_SEVEN_TITLES = [
  'VisionQuest (Season 1)',
  "Papa's Friend (Season 1)",
  'Black Clover: Sword of the Wizard King',
  'Doomsday',
  'The Iron Giant',
  'The Raven',
  'The Royal Cat'
];

// TEST 1: Review queue / inventory records the 7 titles with reason 'no_eligible_links'
runTest('Review queue / inventory records the 7 incomplete titles with reason no_eligible_links', () => {
  const rqPath = path.join(__dirname, '..', 'data', 'review_queue.json');
  assert.ok(fs.existsSync(rqPath), 'Review queue file must exist');
  const rq = JSON.parse(fs.readFileSync(rqPath, 'utf8'));

  assert.ok(rq.records.length >= 7, 'Must have at least 7 review-queue records');
  EXPECTED_SEVEN_TITLES.forEach((expectedTitle) => {
    const item = rq.records.find(r => r.candidate && r.candidate.displayTitle === expectedTitle);
    assert.ok(item, `Review queue must contain record for ${expectedTitle}`);
    assert.strictEqual(item.reason, 'no_eligible_links');
    if (expectedTitle.includes('Black Clover')) {
      assert.strictEqual(item.status, 'resolved');
      assert.strictEqual(item.resolution, 'imported_with_verified_hubcloud_links');
    } else if (expectedTitle.includes("Papa's Friend")) {
      assert.ok(item.status === 'resolved' || item.status === 'pending_review');
    } else {
      assert.strictEqual(item.status, 'pending_review');
    }
    assert.ok(item.candidate.sourceUrl.startsWith('https://new7.hdhub4u.cl/'));
  });
});

// TEST 2: Deployed importer recognizes all three approved HDHub4u URL prefixes
runTest('Deployed importer recognizes hubdrive.pics/file/, hblinks.lol/archives/, and hubcloud.ist/drive/ prefixes', () => {
  const adapter = new HDHub4uAdapter();
  const config = getProviderConfig('HDHub4u');

  // Check provider configuration
  assert.ok(config.eligibilityRules.approvedPrefixes.includes('https://hubdrive.pics/file/'));
  assert.ok(config.eligibilityRules.approvedPrefixes.includes('https://hblinks.lol/archives/'));
  assert.ok(config.eligibilityRules.approvedPrefixes.includes('https://hubcloud.ist/drive/'));

  // Check adapter method filterEligibleDownloadLinks
  const testLinks = [
    'https://hubdrive.pics/file/108745291',
    'https://hblinks.lol/archives/54321',
    'https://hubcloud.ist/drive/bc-wizard-king-1080p',
    'https://hubcloud.ist/file/unapproved-path',
    'https://hubcloud.club/drive/fake-domain',
    'https://greenmotors.club/?id=xyz123',
    'https://hdstream4u.com/file/fap29a0f2bkx',
    'https://snvhost.com?ref=badass',
    'https://4khdhub.one/movie-123'
  ];
  const eligible = adapter.filterEligibleDownloadLinks(testLinks);
  assert.strictEqual(eligible.length, 3, 'Only the three approved prefixes must pass filter');
  assert.strictEqual(eligible[0], 'https://hubdrive.pics/file/108745291');
  assert.strictEqual(eligible[1], 'https://hblinks.lol/archives/54321');
  assert.strictEqual(eligible[2], 'https://hubcloud.ist/drive/bc-wizard-king-1080p');

  // Check resolver recognition
  assert.strictEqual(resolver.HUBDRIVE_PREFIX, 'https://hubdrive.pics/file/');
  assert.strictEqual(resolver.HBLINKS_PREFIX, 'https://hblinks.lol/archives/');
  assert.strictEqual(resolver.HUBCLOUD_PREFIX, 'https://hubcloud.ist/drive/');
  assert.deepStrictEqual(resolver.APPROVED_HDHUB4U_PREFIXES, [
    'https://hubdrive.pics/file/',
    'https://hblinks.lol/archives/',
    'https://hubcloud.ist/drive/'
  ]);
});

// TEST 3: Unsupported candidate URLs on the 7 source pages are strictly rejected
runTest('Candidate URLs from all 7 source pages are strictly rejected by resolver and adapter', () => {
  const adapter = new HDHub4uAdapter();

  const candidateUrlsFromPages = [
    // greenmotors.club ad redirectors found on Black Clover, Doomsday, Iron Giant, etc.
    'https://greenmotors.club/?id=cU4ramhFeG50ZWd1VWk1TDB5Um9CVUVzQ1FxR21hMjNIZlRzKzk2R1BNM2lsR0FUaUhlMStYZnJWcnFTb1d1UE5COVg3RU1iTCtVbzQ3clBtTStHWlhCV2tuc3duOFNRZi9HaGdmZnF1djQ9',
    'https://greenmotors.club/?id=ZS9OcUNwTnVDdU4reFJ4R09CK2VhTDVsSmlyMHNVa1hQRnN0Q0FuRUN1QkUzM1phdzhjSFYxUm5yamFMdFlsaVNVdHlRQkhUM0phNkwwZ0FWK1owQTZoMUlHY2xWRG81Tm1jNmFZV2hjVkk9',
    'https://greenmotors.club/?id=TFZOMTg2Zm1vNGM5bU1rMkxwZGNzRVlueWdJOTIyR3U2OXJ2N1Fpa0xBUVhrVGNiS3hqQXFFVFp6NUdFVTNJM3V0MkxoK3hYemhuYkdrb0xnMStVVklFWkhhWXhCWjdZeDRpTGtKVHdzS2c9',
    // hdstream4u.com streaming player found on VisionQuest
    'https://hdstream4u.com/file/fap29a0f2bkx',
    'https://hdstream4u.com/file/r7tl1txdwvzl',
    // snvhost & promotional sites
    'https://snvhost.com?ref=badass',
    'https://4khdhub.one/visionquest-series-8342/'
  ];

  for (const url of candidateUrlsFromPages) {
    const val = adapter.validateLink({ downloadUrl: url });
    assert.strictEqual(val.isValid, false, `URL ${url} must be invalid`);
    assert.strictEqual(adapter.isValidProviderUrl(url), false, `URL ${url} must not be a valid provider URL`);
  }
});

// TEST 4: VisionQuest (Season 1) does NOT have a complete season package
runTest('VisionQuest (Season 1) has only individual episodes and is rejected under series completeness policy', () => {
  // Episode labels from VisionQuest source page
  const vqEpisodeLabels = ['EPiSODE 1', 'EPiSODE 2', 'WATCH', '[EP-02 Added]'];
  for (const label of vqEpisodeLabels) {
    const pkg = resolver.classifySeriesPackage(label);
    assert.strictEqual(pkg.isComplete, false, `Label "${label}" must not be recognized as a complete season`);
    assert.strictEqual(resolver.isCompleteSeason(label), false);
  }

  // VisionQuest heading indicates incomplete series [EP-02 Added]
  const vqHeading = '&#xE02C; VisionQuest (Season 1) WEB-DL [Hindi (DD5.1) &#038; English] 4K 1080p 720p &#038; 480p [x264/10Bit-HEVC] | DisneyPlus Series | [EP-02 Added]';
  const isComplete = resolver.isCompleteSeason(vqHeading);
  assert.strictEqual(isComplete, false, 'Incomplete series heading must not be complete season');
});

// TEST 5: Baseline invariants are intact (count >= 13,642)
runTest('Catalog and downloads baseline invariants are intact and preserved', () => {
  const catPath = path.join(__dirname, '..', 'data', 'catalog.json');
  const dlPath = path.join(__dirname, '..', 'data', 'downloads.json');

  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  const dl = JSON.parse(fs.readFileSync(dlPath, 'utf8'));

  assert.ok(cat.length >= 13642, `Catalog count invariant violated: ${cat.length}`);
  assert.ok(cat.length >= 13715, `Catalog count >= 13,715: actual ${cat.length}`);
  const totalLinks = dl.entries.reduce((sum, e) => sum + (e.links ? e.links.length : 0), 0);
  assert.ok(totalLinks >= 76097, `Downloads count invariant violated: ${totalLinks}`);
  assert.ok(totalLinks >= 76105, `Total links >= 76,105: actual ${totalLinks}`);

  // None of the 7 incomplete titles exist as canonical records without links
  for (const expectedTitle of EXPECTED_SEVEN_TITLES) {
    const found = cat.find(c => c.displayTitle.toLowerCase() === expectedTitle.toLowerCase());
    if (found) {
      assert.ok(found.variants && found.variants.length > 0, `Title ${expectedTitle} must have variants if in catalog`);
    }
  }
});

console.log('='.repeat(75));
console.log(`ALL ${passed}/${total} DIAGNOSTIC & REGRESSION CHECKS PASSED!`);
console.log('='.repeat(75));
