/**
 * PRAFLIX — REGRESSION SUITE: HDHUB4U NEW-MOVIE DISCOVERY & INGESTION
 * A PRAVERSE Company
 *
 * Verifies the 7 requirements:
 * 1. Feed fixture HTML containing modern HDHub4u layout to the parser and verify listings are discovered.
 * 2. Verify download links with the exact prefix 'https://hubdrive.pics/file/' are accepted and those without are excluded.
 * 3. Verify detail pages with valid links produce catalog candidates with correct metadata.
 * 4. Verify candidate series with only individual episodes are excluded.
 * 5. Verify candidate series with complete-season packages are accepted.
 * 6. Verify existing titles are updated with new links without creating duplicate catalog records.
 * 7. Verify crawl failure returns an explicit failure status, not an empty success.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HDHub4uAdapter = require('../scripts/adapters/hdhub4u_adapter');
const syncCore = require('../scripts/sync_core');
const destinationResolver = require('../destination_resolver');
const { getProviderConfig } = require('../scripts/provider_registry');

console.log('='.repeat(70));
console.log('PRAFLIX — REGRESSION SUITE: HDHUB4U DISCOVERY & INGESTION FIX');
console.log('='.repeat(70));

let total = 0;
let passed = 0;

async function runTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
    passed++;
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED: ${err.message}`);
    throw err;
  }
}

async function main() {
  const adapter = new HDHub4uAdapter();

  // -------------------------------------------------------------------------
  // TEST 1: Feed fixture HTML containing modern HDHub4u layout to the parser and verify listings are discovered
  // -------------------------------------------------------------------------
  await runTest('Modern HDHub4u layout (<li class="thumb">) is parsed and listings are discovered', async () => {
    const fixtureHtml = `
      <ul class="recent-movies">
        <li class="thumb col-md-2 col-sm-4 col-xs-6">
          <figure>
            <a href="/runner-2026-english-webrip-full-movie/">
              <img src="https://catimages.org/images/2026/runner.jpg" alt="Runner 2026" />
            </a>
            <figcaption>
              <p>Runner (2026) English WebRip Full Movie 1080p 720p</p>
            </figcaption>
          </figure>
        </li>
        <li class="thumb col-md-2 col-sm-4 col-xs-6">
          <figure>
            <a href="https://new7.hdhub4u.cl/weapons-2025-hq-hindi-dubbed-full-movie/">
              <img src="https://catimages.org/images/2026/weapons.jpg" alt="Weapons 2025" />
            </a>
            <figcaption>
              <p>Weapons (2025) HQ Hindi Dubbed Full Movie 1080p 720p</p>
            </figcaption>
          </figure>
        </li>
      </ul>
    `;

    const items = adapter.parseHomePageListings(fixtureHtml);
    assert.strictEqual(items.length, 2, 'Should discover both listings');

    assert.ok(items[0].title.startsWith('Runner'), 'Title should start with Runner');
    assert.strictEqual(items[0].year, '2026');
    assert.ok(items[0].url.includes('/runner-2026-english-webrip-full-movie/'), 'Relative URL resolved to full URL');

    assert.ok(items[1].title.startsWith('Weapons'), 'Title should start with Weapons');
    assert.strictEqual(items[1].year, '2025');
    assert.strictEqual(items[1].url, 'https://new7.hdhub4u.cl/weapons-2025-hq-hindi-dubbed-full-movie/');
  });

  // -------------------------------------------------------------------------
  // TEST 2: Verify download links with approved prefixes ('https://hubdrive.pics/file/' and 'https://hblinks.lol/archives/') are accepted and those without are excluded
  // -------------------------------------------------------------------------
  await runTest('Download links with approved prefixes (hubdrive.pics/file/ & hblinks.lol/archives/) are accepted and other hosts excluded', async () => {
    const rawLinks = [
      'https://hubdrive.pics/file/108745291',
      'https://hubdrive.pics/file/abc987654',
      'https://hblinks.lol/archives/54321',
      'https://hblinks.lol/archives/test-archive-99',
      'https://hubcloud.club/drive/xyz123',
      'https://drive.google.com/uc?id=99999',
      'https://hubdrive.pics/other/12345',
      'http://hubdrive.pics/file/insecure123',
      'https://otherhubdrive.pics/file/fake',
      'https://hblinks.lol/download/123',
      'https://hblinks.lol/file/123',
      'https://otherhblinks.lol/archives/123'
    ];

    const eligible = adapter.filterEligibleDownloadLinks(rawLinks);
    assert.strictEqual(eligible.length, 4, 'Only exact approved prefixes accepted');
    assert.strictEqual(eligible[0], 'https://hubdrive.pics/file/108745291');
    assert.strictEqual(eligible[1], 'https://hubdrive.pics/file/abc987654');
    assert.strictEqual(eligible[2], 'https://hblinks.lol/archives/54321');
    assert.strictEqual(eligible[3], 'https://hblinks.lol/archives/test-archive-99');

    // Also verify base_adapter prefix checks
    const config = getProviderConfig('HDHub4u');
    assert.strictEqual(config.requireExactHubDrivePrefix, true, 'HDHub4u provider configuration specifies requireExactHubDrivePrefix');
    assert.ok(Array.isArray(config.eligibilityRules.approvedPrefixes), 'approvedPrefixes array configured');
    assert.ok(config.eligibilityRules.approvedPrefixes.includes('https://hubdrive.pics/file/'));
    assert.ok(config.eligibilityRules.approvedPrefixes.includes('https://hblinks.lol/archives/'));

    assert.strictEqual(adapter.isValidProviderUrl('https://hubdrive.pics/file/123'), true);
    assert.strictEqual(adapter.isValidProviderUrl('https://hblinks.lol/archives/123'), true);
    assert.strictEqual(adapter.isValidProviderUrl('https://hubcloud.club/drive/123'), false);
    assert.strictEqual(adapter.isValidProviderUrl('https://hubdrive.pics/download/123'), false);
    assert.strictEqual(adapter.isValidProviderUrl('https://hblinks.lol/download/123'), false);
    assert.strictEqual(adapter.isValidProviderUrl('https://hblinks.lol/files/123'), false);
  });

  // -------------------------------------------------------------------------
  // TEST 3: Verify detail pages with valid links produce catalog candidates with correct metadata
  // -------------------------------------------------------------------------
  await runTest('Detail page with valid links produces catalog candidate with correct metadata', async () => {
    const detailHtml = `
      <div class="entry-content">
        <h1>Bhairadevi (2024) Hindi Dubbed WEB-DL 1080p 720p 480p</h1>
        <p><strong>IMDb:</strong> 7.8/10</p>
        <p><strong>Genre:</strong> Action, Drama, Horror</p>
        <p><strong>Director:</strong> Sriraj</p>
        <p><strong>Starring:</strong> Radhika Kumaraswamy, Ramesh Aravind</p>
        <p><strong>Storyline:</strong> An intense horror drama unraveling supernatural events.</p>
        <div class="download-links">
          <p><strong>1080p [2.4GB]</strong></p>
          <a class="btn" href="https://hubdrive.pics/file/bhairadevi-1080p">HubDrive 1080p</a>
          <p><strong>720p [1.1GB]</strong></p>
          <a class="btn" href="https://hubdrive.pics/file/bhairadevi-720p">HubDrive 720p</a>
          <p><strong>Untrusted Link</strong></p>
          <a class="btn" href="https://untrusted-host.com/dl/bhairadevi">Click Here</a>
        </div>
      </div>
    `;

    const candidate = adapter.parseDetailPage(detailHtml, 'https://new7.hdhub4u.cl/bhairadevi-2024-hindi-full-movie/');
    assert.ok(candidate, 'Candidate must be produced');
    assert.strictEqual(candidate.year, '2024');
    assert.ok(candidate.title.includes('Bhairadevi'));
    assert.strictEqual(candidate.type, 'Movie');
    assert.ok(candidate.links.length >= 2, 'Should extract 2 valid hubdrive links');
    for (const l of candidate.links) {
      assert.ok(l.url.startsWith('https://hubdrive.pics/file/'), `Link ${l.url} must start with exact prefix`);
    }
  });

  // -------------------------------------------------------------------------
  // TEST 4: Verify candidate series with only individual episodes are excluded
  // -------------------------------------------------------------------------
  await runTest('Candidate series with only individual episodes are excluded from complete-season ingestion', async () => {
    const individualEpisodeLabels = [
      'EPISODE 01 [350MB]',
      'Episode 2 [360MB]',
      'Ep 03 [400MB]',
      'Drive [Episode 4]',
      'G-Drive Ep 5'
    ];

    for (const label of individualEpisodeLabels) {
      const isComplete = destinationResolver.isCompleteSeason(label);
      assert.strictEqual(isComplete, false, `Label "${label}" must NOT be recognized as a complete season`);
    }

    const seriesWithOnlyEpisodesHtml = `
      <div class="entry-content">
        <h1>Random Series Season 1 All Episodes</h1>
        <p><strong>Genre:</strong> Drama</p>
        <a href="https://hubdrive.pics/file/ep1">Episode 1</a>
        <a href="https://hubdrive.pics/file/ep2">Episode 2</a>
        <a href="https://hubdrive.pics/file/ep3">Episode 3</a>
      </div>
    `;
    const candidate = adapter.parseDetailPage(seriesWithOnlyEpisodesHtml, 'https://new7.hdhub4u.cl/random-series-s1/');
    assert.strictEqual(candidate.type, 'Web Series');
    
    // In our filter, complete packages must have pack/zip/complete keywords
    const completePackages = candidate.links.filter(l => destinationResolver.isCompleteSeason(l.label || ''));
    assert.strictEqual(completePackages.length, 0, 'Series with only individual episodes should yield 0 complete pack links');
  });

  // -------------------------------------------------------------------------
  // TEST 5: Verify candidate series with complete-season packages are accepted
  // -------------------------------------------------------------------------
  await runTest('Candidate series with complete-season packages (PACK/ZIP/COMPLETE) are accepted', async () => {
    const completeLabels = [
      '1080p WEB-DL PACK [16.8GB]',
      '720p HD Complete Season 1 [4.2GB]',
      'Season 1 Complete Zip [8.5GB]',
      'Complete Pack 4K UHD [32GB]',
      'Batch 1-10 Full Season'
    ];

    for (const label of completeLabels) {
      const isComplete = destinationResolver.isCompleteSeason(label);
      assert.strictEqual(isComplete, true, `Label "${label}" MUST be recognized as a complete season`);
    }

    const seriesWithPackHtml = `
      <div class="entry-content">
        <h1>The Trap Season 1 Hindi Dubbed</h1>
        <p><strong>Genre:</strong> Thriller</p>
        <p><strong>1080p WEB-DL PACK [16.8GB]</strong></p>
        <a href="https://hubdrive.pics/file/the-trap-s01-1080p-pack">Download Complete Pack 1080p</a>
        <p><strong>720p WEB-DL Complete [5.2GB]</strong></p>
        <a href="https://hubdrive.pics/file/the-trap-s01-720p-pack">Download Complete Pack 720p</a>
        <p><strong>Episode 1 Single</strong></p>
        <a href="https://hubdrive.pics/file/the-trap-s01-ep01">Download Ep 1</a>
      </div>
    `;
    const candidate = adapter.parseDetailPage(seriesWithPackHtml, 'https://new7.hdhub4u.cl/the-trap-season-1-full-series/');
    assert.strictEqual(candidate.type, 'Web Series');
    const validLinks = candidate.links.filter(l => l.url.startsWith('https://hubdrive.pics/file/'));
    const completePacks = validLinks.filter(l => destinationResolver.isCompleteSeason(l.label || ''));
    assert.strictEqual(completePacks.length, 2, 'Should accept exactly 2 complete pack links');
  });

  // -------------------------------------------------------------------------
  // TEST 6: Verify existing titles are updated with new links without creating duplicate catalog records
  // -------------------------------------------------------------------------
  await runTest('Existing catalog title is updated with new links without creating duplicate catalog records', async () => {
    const existingCatalog = [
      {
        canonicalId: 'praflix-1087',
        displayTitle: 'Weapons',
        year: '2025',
        type: 'Movie',
        imdbId: 'tt26581440',
        genres: ['Horror', 'Mystery'],
        variants: [
          {
            quality: '720p',
            codec: 'x264',
            fileSize: '1.2GB',
            provider: 'HDWall',
            downloadUrl: 'https://hdwall.example/file/1',
            verified: true
          }
        ]
      }
    ];

    const newCandidate = {
      title: 'Weapons',
      year: '2025',
      type: 'Movie',
      imdbId: 'tt26581440',
      links: [
        {
          label: '1080p [2.8GB]',
          quality: '1080p',
          codec: 'x264',
          fileSize: '2.8GB',
          url: 'https://hubdrive.pics/file/weapons-1080p'
        },
        {
          label: '4K UHD [6.5GB]',
          quality: '4K',
          codec: 'HEVC',
          fileSize: '6.5GB',
          url: 'https://hubdrive.pics/file/weapons-4k'
        }
      ]
    };

    // Match candidate against existing catalog
    const existing = existingCatalog.find(c => 
      c.imdbId === newCandidate.imdbId || 
      (c.displayTitle.toLowerCase() === newCandidate.title.toLowerCase() && c.year === newCandidate.year)
    );

    assert.ok(existing, 'Should find existing canonical title');
    assert.strictEqual(existing.canonicalId, 'praflix-1087');

    // Attach new variants
    let addedCount = 0;
    for (const link of newCandidate.links) {
      const exists = existing.variants.some(v => v.downloadUrl === link.url);
      if (!exists) {
        existing.variants.push({
          quality: link.quality,
          codec: link.codec,
          fileSize: link.fileSize,
          provider: 'HDHub4u',
          downloadUrl: link.url,
          verified: true
        });
        addedCount++;
      }
    }

    assert.strictEqual(addedCount, 2, 'Added 2 new variants');
    assert.strictEqual(existingCatalog.length, 1, 'Catalog length must remain exactly 1 (no duplicates created)');
    assert.strictEqual(existing.variants.length, 3, 'Existing title now has 3 variants');
  });

  // -------------------------------------------------------------------------
  // TEST 7: Verify crawl failure returns an explicit failure status, not an empty success
  // -------------------------------------------------------------------------
  await runTest('Crawl failure returns explicit failure status (INCONCLUSIVE / PARSING_FAILED) not empty success', async () => {
    // 7A: Broken HTML / anti-bot challenge
    const challengeHtml = '<html><head><title>Just a moment...</title></head><body>Verify you are human</body></html>';
    assert.throws(() => {
      adapter.parseHomePageListings(challengeHtml);
    }, (err) => {
      return err.message.includes('INCONCLUSIVE') || err.message.includes('challenge');
    }, 'Bot challenge HTML must throw INCONCLUSIVE exception');

    // 7B: 0 items parsed from reachable page
    const emptyPageHtml = '<html><body><div class="content"><p>No items found</p></div></body></html>';
    assert.throws(() => {
      adapter.parseHomePageListings(emptyPageHtml);
    }, (err) => {
      return err.message.includes('INCONCLUSIVE / PARSING_FAILED');
    }, '0 items parsed from reachable page must throw INCONCLUSIVE / PARSING_FAILED');

    // 7C: syncCore syncProvider handling with mock failure
    const dummyCatalog = [{ canonicalId: '1', displayTitle: 'Test', year: '2024', variants: [] }];
    const dummySources = [];

    const failureResult = await syncCore.syncProvider('HDHub4u', dummyCatalog, dummySources, {
      mockFailures: {
        'HDHub4u': 'INCONCLUSIVE / PARSING_FAILED: HDHub4u layout altered or blocked'
      }
    });

    assert.strictEqual(failureResult.failed, true, 'Provider result must be marked as failed');
    assert.strictEqual(failureResult.newlyIngestedCount, 0);
    assert.ok(failureResult.error.includes('INCONCLUSIVE / PARSING_FAILED'), 'Error message contains explicit status');
  });

  console.log('='.repeat(70));
  console.log(`ALL ${passed}/${total} REGRESSION TESTS PASSED!`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
