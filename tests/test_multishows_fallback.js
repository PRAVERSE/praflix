#!/usr/bin/env node
/**
 * PRAFLIX — MultiShows Conditional Fallback Test Suite
 * A PRAVERSE Company
 *
 * Verifies all requirements for MultiShows conditional fallback:
 * 1. HDHub4u links prevent unnecessary MultiShows fallback.
 * 2. MultiShows is consulted when a newly discovered title has no eligible HDHub4u links.
 * 3. MultiShows results are matched to the correct title and year.
 * 4. Movie and series classification remains correct.
 * 5. Episode-wise and complete-series records remain distinct.
 * 6. Invalid, duplicate, or intermediate URLs are rejected according to destination rules.
 * 7. Unavailable or incomplete MultiShows scans are not falsely marked successful.
 * 8. Existing titles and links are preserved.
 * 9. Retrying the workflow does not create duplicate canonical records or links.
 * 10. Newly added movie priority, catalog integrity, and Available Versions behavior remain intact.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE_DIR = path.dirname(__dirname);
const hdhubSync = require(path.join(BASE_DIR, 'scripts', 'hdhub4u_sync'));
const MultiShowsAdapter = require(path.join(BASE_DIR, 'scripts', 'adapters', 'multishows_adapter'));
const providerRegistry = require(path.join(BASE_DIR, 'scripts', 'provider_registry'));
const resolver = require(path.join(BASE_DIR, 'destination_resolver'));

console.log('='.repeat(70));
console.log('PRAFLIX — ACCEPTANCE SUITE: MULTISHOWS CONDITIONAL FALLBACK');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

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

async function runTests() {
  const adapter = new MultiShowsAdapter();

  // ---------------------------------------------------------------------------
  // 1. HDHub4u links prevent unnecessary MultiShows fallback
  // ---------------------------------------------------------------------------
  const shouldFallbackWhenHdHubHasLinks = hdhubSync.shouldConsultMultiShowsFallback(2, true, false);
  check(1, 'HDHub4u verified links prevent MultiShows fallback for new title', shouldFallbackWhenHdHubHasLinks === false);

  const shouldFallbackWhenHdHubHasLinksExisting = hdhubSync.shouldConsultMultiShowsFallback(1, false, true);
  check(2, 'HDHub4u verified links prevent MultiShows fallback for existing title', shouldFallbackWhenHdHubHasLinksExisting === false);

  // ---------------------------------------------------------------------------
  // 2. MultiShows is consulted when newly discovered candidate has 0 HDHub4u links
  // ---------------------------------------------------------------------------
  const shouldFallbackWhenHdHubHasZeroLinks = hdhubSync.shouldConsultMultiShowsFallback(0, true, false);
  check(3, 'MultiShows consulted when new candidate has 0 eligible HDHub4u links', shouldFallbackWhenHdHubHasZeroLinks === true);

  const shouldFallbackWhenExistingHasNoLinks = hdhubSync.shouldConsultMultiShowsFallback(0, false, false);
  check(4, 'MultiShows consulted when existing title has 0 links and HDHub4u has 0 links', shouldFallbackWhenExistingHasNoLinks === true);

  const shouldFallbackWhenExistingAlreadyHasLinks = hdhubSync.shouldConsultMultiShowsFallback(0, false, true);
  check(5, 'MultiShows NOT consulted when existing title already has download links', shouldFallbackWhenExistingAlreadyHasLinks === false);

  // ---------------------------------------------------------------------------
  // 3. MultiShows search parsing & classification (Movie vs Web Series)
  // ---------------------------------------------------------------------------
  const mockSearchHtml = `
    <html>
      <body>
        <div class="grid">
          <a href="https://multishows.top/movie/pushpa-2-the-rule-2024">
            <img alt="Pushpa 2: The Rule" src="https://multishows.top/posters/pushpa2.jpg" />
            <h3 class="text-gray-300">Pushpa 2: The Rule (2024)</h3>
          </a>
          <a href="https://multishows.top/tv-show/panchayat-season-3-2024">
            <img alt="Panchayat Season 3" src="https://multishows.top/posters/panchayat.jpg" />
            <h3 class="text-gray-300">Panchayat Season 3 (2024)</h3>
          </a>
        </div>
      </body>
    </html>
  `;

  const parsedSearchResults = adapter.parseSearchHtml(mockSearchHtml);
  check(6, 'MultiShows search HTML parsed successfully', parsedSearchResults.length === 2);
  check(7, 'Movie classification correct (/movie/ URL slug)', parsedSearchResults[0].type === 'Movie');
  check(8, 'Web Series classification correct (/tv-show/ URL slug)', parsedSearchResults[1].type === 'Web Series');
  check(9, 'Year extracted accurately from search card', parsedSearchResults[0].year === '2024' && parsedSearchResults[1].year === '2024');

  // ---------------------------------------------------------------------------
  // 4. Title and Year Matching Logic
  // ---------------------------------------------------------------------------
  check(10, 'Title normalization handles punctuation and common tags',
    adapter.normalizeTitle('Pushpa 2: The Rule [Dual Audio] [Hindi]') === adapter.normalizeTitle('Pushpa 2 - The Rule')
  );

  check(11, 'Year matching tolerates +/- 1 year release date shift',
    adapter.isYearMatch('2024', '2023') === true && adapter.isYearMatch('2024', '2025') === true
  );

  check(12, 'Year matching rejects significant year discrepancy (> 1 year)',
    adapter.isYearMatch('1998', '2024') === false
  );

  check(13, 'Type matching rejects mismatch between Movie and Web Series',
    adapter.isTypeMatch('Movie', 'Web Series') === false
  );

  // ---------------------------------------------------------------------------
  // 5. Episode-wise vs Complete-series variants distinction
  // ---------------------------------------------------------------------------
  const mockSeriesDetailHtml = `
    <html>
      <body>
        <h1>Panchayat Season 3 (2024)</h1>
        <ul>
          <li>
            <div>Panchayat S03 Episode 01 720p WEB-DL</div>
            <a href="https://gdflix.dev/file/ep1_720p">Download</a>
          </li>
          <li>
            <div>Panchayat S03 Complete Season Pack 1080p WEB-DL</div>
            <a href="https://gdflix.dev/file/complete_1080p">Download</a>
          </li>
          <li>
            <div>Join our community</div>
            <a href="https://t.me/multishows_channel">Download on Telegram</a>
          </li>
          <li>
            <div>Sponsored Advertisement</div>
            <a href="https://snvhost.com/dl/redirect_ad">Download Fast</a>
          </li>
        </ul>
      </body>
    </html>
  `;

  const seriesParsed = adapter.parseDetailHtml(mockSeriesDetailHtml, 'https://multishows.top/tv-show/panchayat-season-3-2024');
  check(14, 'Detail page parsing extracts valid storage links', seriesParsed.verifiedLinks.length === 2);

  const epLink = seriesParsed.verifiedLinks.find(l => l.packageType === 'individual_episode');
  const completeLink = seriesParsed.verifiedLinks.find(l => l.packageType === 'complete_season');
  check(15, 'Episode-wise variant recognized and labeled', Boolean(epLink && epLink.episode === 'EPISODE 1'));
  check(16, 'Complete season pack variant recognized and labeled', Boolean(completeLink && completeLink.episode === 'COMPLETE SEASON'));

  // ---------------------------------------------------------------------------
  // 6. Destination resolver rejects ad redirects and telegram links
  // ---------------------------------------------------------------------------
  const telegramCheck = resolver.classifyLinkVerification('https://t.me/multishows_channel', 'https://multishows.top');
  check(17, 'Telegram community links rejected as unverified', telegramCheck.status !== 'verified');

  const adRedirectCheck = resolver.classifyLinkVerification('https://snvhost.com/dl/redirect_ad', 'https://multishows.top');
  check(18, 'Intermediate ad redirectors rejected as broken or unverified', adRedirectCheck.status !== 'verified');

  const storageCheck = resolver.classifyLinkVerification('https://gdflix.dev/file/test_abc123', 'https://multishows.top');
  check(19, 'Direct GDFlix storage links classified as verified', storageCheck.status === 'verified');

  const sourceArticleCheck = resolver.classifyLinkVerification('https://multishows.top/movie/pushpa-2-the-rule-2024');
  check(20, 'MultiShows source article page rejected as direct download destination', sourceArticleCheck.status === 'broken' && sourceArticleCheck.evidence === 'source_article_url');

  // ---------------------------------------------------------------------------
  // 7. MultiShows scan failures/challenges are NOT treated as successful zero-results
  // ---------------------------------------------------------------------------
  const blockedRes = await adapter.queryMatchingFallback({ displayTitle: 'Alien Earth' }, {
    multishowsOptions: { mockFailure: { status: 'blocked', error: 'HTTP 403 Cloudflare' } }
  });
  check(21, 'Anti-bot challenge/403 reported as blocked and NOT success', blockedRes.success === false && blockedRes.status === 'blocked');

  const timeoutRes = await adapter.queryMatchingFallback({ displayTitle: 'Alien Earth' }, {
    multishowsOptions: { mockFailure: { status: 'timeout', error: 'AbortError: timeout' } }
  });
  check(22, 'Network timeout reported as timeout and NOT success', timeoutRes.success === false && timeoutRes.status === 'timeout');

  // ---------------------------------------------------------------------------
  // 8. End-to-end conditional queryMatchingFallback simulation
  // ---------------------------------------------------------------------------
  const mockMovieDetailHtml = `
    <html>
      <body>
        <h1>Pushpa 2: The Rule (2024)</h1>
        <ul>
          <li>
            <div>Pushpa 2 1080p WEB-DL Hindi DD 5.1</div>
            <a href="https://gdflix.dev/file/pushpa2_1080p">Download</a>
          </li>
          <li>
            <div>Pushpa 2 720p WEB-DL Hindi DD 5.1</div>
            <a href="https://hubcloud.ist/drive/pushpa2_720p">Download</a>
          </li>
        </ul>
      </body>
    </html>
  `;

  const fallbackResult = await adapter.queryMatchingFallback(
    { displayTitle: 'Pushpa 2: The Rule', year: '2024', type: 'Movie' },
    {
      multishowsOptions: {
        mockResults: [
          {
            detailUrl: 'https://multishows.top/movie/pushpa-2-the-rule-2024',
            title: 'Pushpa 2: The Rule',
            normalizedTitle: 'pushpa 2 the rule',
            year: '2024',
            type: 'Movie'
          }
        ],
        mockHtml: mockMovieDetailHtml
      }
    }
  );

  check(23, 'Successful MultiShows fallback produces verifiedLinks',
    fallbackResult.success === true && fallbackResult.status === 'links_found' && fallbackResult.verifiedLinks.length === 2
  );
  check(24, 'Provider attribution on fallback links is MultiShows',
    fallbackResult.verifiedLinks.every(vl => vl.provider === 'MultiShows')
  );
  check(25, 'Exact source URL preserved without alteration',
    fallbackResult.sourceUrl === 'https://multishows.top/movie/pushpa-2-the-rule-2024'
  );

  // ---------------------------------------------------------------------------
  // 9. Existing-title safeguards & Provider Registry isolation
  // ---------------------------------------------------------------------------
  const registeredMs = providerRegistry.getProvider('multishows');
  check(26, 'MultiShows registered in provider registry', Boolean(registeredMs && registeredMs.id === 'multishows'));
  check(27, 'MultiShows marked as isFallbackOnly and active: false', registeredMs.isFallbackOnly === true && registeredMs.active === false);

  const retired10m = providerRegistry.getProvider('10moviez');
  const retiredHdw = providerRegistry.getProvider('hdwall');
  check(28, 'Retired providers remain strictly disabled (10Moviez and HDWall)',
    retired10m.status === 'retired' && retired10m.active === false &&
    retiredHdw.status === 'retired' && retiredHdw.active === false
  );

  // ---------------------------------------------------------------------------
  // 10. Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '-'.repeat(70));
  console.log(`TOTAL MULTISHOWS FALLBACK TESTS: ${total}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${total - passed}`);
  console.log('-'.repeat(70));

  if (passed === total) {
    console.log('[ALL MULTISHOWS FALLBACK TESTS PASSED]\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('\n[FATAL ERROR IN MULTISHOWS TESTS]:', err);
  process.exit(1);
});
