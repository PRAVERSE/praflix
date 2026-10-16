/**
 * PRAFLIX — Test Suite: Incomplete Imports Bounded Retry Loop & Recovery
 * A PRAVERSE Company
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IncompleteRetryManager = require('../scripts/incomplete_retry_manager');

const TEST_STATE_PATH = path.join(__dirname, '..', 'data', 'test_retry_state_scratch.json');

console.log('='.repeat(75));
console.log('PRAFLIX — ACCEPTANCE SUITE: INCOMPLETE IMPORTS RETRY LOOP & RECOVERY');
console.log('='.repeat(75));

let total = 0;
let passed = 0;

function runTest(name, fn) {
  total++;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => {
        console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
        passed++;
      }).catch(err => {
        console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED: ${err.message}`);
        throw err;
      });
    }
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
    passed++;
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED: ${err.message}`);
    throw err;
  }
}

async function main() {
  try {
    if (fs.existsSync(TEST_STATE_PATH)) fs.unlinkSync(TEST_STATE_PATH);

    // Test 1: Transient network error with exponential backoff & recovery
    await runTest('Transient network error retries with exponential backoff and recovers', async () => {
      let callCount = 0;
      const sleeps = [];
      const mockFetch = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('ETIMEDOUT: Connection timed out');
        }
        return {
          ok: true,
          status: 200,
          text: async () => `<html><body><a href="https://hubdrive.pics/file/991823741">1080p [2.4GB]</a></body></html>`
        };
      };

      const mgr = new IncompleteRetryManager({
        maxAttempts: 3,
        initialBackoffMs: 100,
        maxBackoffMs: 500,
        fetchFn: mockFetch,
        sleepFn: async (ms) => { sleeps.push(ms); },
        stateFilePath: TEST_STATE_PATH
      });

      const result = await mgr.retryTitle({
        title: 'Transient Film',
        sourceUrl: 'https://new8.hdhub4u.cl/transient-film/'
      });

      assert.strictEqual(result.status, 'recovered');
      assert.strictEqual(result.attempts, 2);
      assert.strictEqual(sleeps.length, 1);
      assert.ok(sleeps[0] >= 100, 'Backoff must respect initial backoff threshold');
      assert.strictEqual(result.validDestinations.length, 1);
      assert.strictEqual(result.validDestinations[0].downloadUrl, 'https://hubdrive.pics/file/991823741');
    });

    // Test 2: HTTP 429 Rate Limiting respects Retry-After header
    await runTest('HTTP 429 Rate Limiting respects Retry-After header', async () => {
      let callCount = 0;
      const sleeps = [];
      const mockFetch = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Map([['retry-after', '3']]),
            text: async () => 'Too Many Requests'
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => `<html><body><a href="https://hubdrive.pics/file/88442211">720p</a></body></html>`
        };
      };

      const mgr = new IncompleteRetryManager({
        maxAttempts: 3,
        fetchFn: mockFetch,
        sleepFn: async (ms) => { sleeps.push(ms); },
        stateFilePath: TEST_STATE_PATH
      });

      const result = await mgr.retryTitle({
        title: 'Rate Limited Movie',
        sourceUrl: 'https://new8.hdhub4u.cl/rate-limited/'
      });

      assert.strictEqual(result.status, 'recovered');
      assert.strictEqual(result.attempts, 2);
      assert.strictEqual(sleeps.length, 1);
      assert.strictEqual(sleeps[0], 3000, 'Must pause for exactly 3000ms as requested by Retry-After: 3');
    });

    // Test 3: Distinction between zero candidate links vs rejected eligibility links
    await runTest('Accurately distinguishes zero candidate links from rejected eligibility candidates', async () => {
      const mgr = new IncompleteRetryManager({ stateFilePath: TEST_STATE_PATH });

      // Zero candidate anchors
      const emptyHtml = `<html><body><p>No links here</p></body></html>`;
      const emptyInspection = mgr.inspectPageCandidates(emptyHtml, 'https://new8.hdhub4u.cl/empty/');
      assert.strictEqual(emptyInspection.candidateUrls.length, 0);
      const emptyCategory = mgr.classifyFailure({
        httpStatus: 200,
        extractedCandidates: emptyInspection.candidateUrls,
        rejectedReasons: emptyInspection.rejectedReasons
      });
      assert.strictEqual(emptyCategory, 'source_page_fetched_no_links');

      // Rejected candidates (greenmotors.club intermediate ad protector)
      const adHtml = `<html><body>
        <a href="https://greenmotors.club/?id=xyz123">480p Download</a>
        <a href="https://hdstream4u.com/file/play99">Watch Online</a>
      </body></html>`;
      const adInspection = mgr.inspectPageCandidates(adHtml, 'https://new8.hdhub4u.cl/ad-film/');
      assert.strictEqual(adInspection.candidateUrls.length, 2);
      assert.strictEqual(adInspection.rejectedReasons.length, 2);
      assert.ok(adInspection.rejectedReasons[0].reason.includes('greenmotors.club'));
      assert.ok(adInspection.rejectedReasons[1].reason.includes('hdstream4u.com'));
      const adCategory = mgr.classifyFailure({
        httpStatus: 200,
        extractedCandidates: adInspection.candidateUrls,
        rejectedReasons: adInspection.rejectedReasons
      });
      assert.strictEqual(adCategory, 'rejected_by_eligibility');
    });

    // Test 4: Retry attempt exhaustion returns unresolved_after_retries
    await runTest('Retry attempt exhaustion returns unresolved_after_retries with failure history', async () => {
      const mockFetch = async () => {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable'
        };
      };

      const mgr = new IncompleteRetryManager({
        maxAttempts: 2,
        initialBackoffMs: 10,
        maxBackoffMs: 20,
        fetchFn: mockFetch,
        sleepFn: async () => {},
        stateFilePath: TEST_STATE_PATH
      });

      const result = await mgr.retryTitle({
        title: 'Persistent 503 Movie',
        sourceUrl: 'https://new8.hdhub4u.cl/persistent-503/'
      });

      assert.strictEqual(result.status, 'unresolved_after_retries');
      assert.strictEqual(result.attempts, 2);
      assert.strictEqual(result.failureCategory, 'retryable_server_error');
      assert.strictEqual(result.history.length, 2);
    });

    // Test 5: Completed inspection with zero eligible links on unchanged page halts without wasteful looping
    await runTest('Completed inspection on clean page halts after 1 attempt without infinite looping', async () => {
      let fetchCalls = 0;
      const mockFetch = async () => {
        fetchCalls++;
        return {
          ok: true,
          status: 200,
          text: async () => `<html><body><a href="https://greenmotors.club/?id=test">1080p</a></body></html>`
        };
      };

      const mgr = new IncompleteRetryManager({
        maxAttempts: 3,
        fetchFn: mockFetch,
        sleepFn: async () => {},
        stateFilePath: TEST_STATE_PATH
      });

      const result = await mgr.retryTitle({
        title: 'Static Ad Page',
        sourceUrl: 'https://new8.hdhub4u.cl/static-ad-page/'
      });

      assert.strictEqual(fetchCalls, 1, 'Must not repeatedly fetch unchanged page when rejected by eligibility');
      assert.strictEqual(result.status, 'unresolved_after_retries');
      assert.strictEqual(result.failureCategory, 'rejected_by_eligibility');
    });

    // Test 6: Concurrency lock prevents duplicate concurrent retry jobs for the same title
    await runTest('Active concurrency lock prevents duplicate concurrent retry jobs for the same title', async () => {
      let activeCalls = 0;
      let maxConcurrent = 0;

      const mockFetch = async () => {
        activeCalls++;
        if (activeCalls > maxConcurrent) maxConcurrent = activeCalls;
        await new Promise(r => setTimeout(r, 50));
        activeCalls--;
        return {
          ok: true,
          status: 200,
          text: async () => `<html><body><a href="https://hubdrive.pics/file/555111">720p</a></body></html>`
        };
      };

      const mgr = new IncompleteRetryManager({
        maxAttempts: 2,
        fetchFn: mockFetch,
        stateFilePath: TEST_STATE_PATH
      });

      const candidate = {
        title: 'Concurrent Film',
        sourceUrl: 'https://new8.hdhub4u.cl/concurrent-film/'
      };

      const [job1, job2] = await Promise.all([
        mgr.retryTitle(candidate),
        mgr.retryTitle(candidate)
      ]);

      assert.strictEqual(maxConcurrent, 1, 'Never allow more than 1 active job for same title');
      const skipped = [job1, job2].find(j => j.status === 'skipped_concurrent_active');
      const executed = [job1, job2].find(j => j.status === 'recovered');
      assert.ok(skipped, 'One of the concurrent executions must be safely skipped');
      assert.ok(executed, 'One of the concurrent executions must run to completion');
    });

    // Test 7: Recording reference landing page marks isDirectDownloadDestination as false
    runTest('Recording reference landing page marks isDirectDownloadDestination as false', () => {
      const mgr = new IncompleteRetryManager({ stateFilePath: TEST_STATE_PATH });
      const record = mgr.recordReferencePage(
        'Star Wars: Episode II - Attack of the Clones (2002)',
        'https://hblinks.lol/archives/120866',
        '1080p',
        'Unverified source information recorded per instruction'
      );

      assert.strictEqual(record.isDirectDownloadDestination, false);
      assert.strictEqual(record.status, 'unverified_reference_source');
      assert.strictEqual(record.referenceUrl, 'https://hblinks.lol/archives/120866');
    });

    // Test 8: Exactly-once notification summary generation with run key
    runTest('Generates single deterministic notification summary with run idempotency key', () => {
      const mgr = new IncompleteRetryManager({ stateFilePath: TEST_STATE_PATH });
      const batchResults = [
        { status: 'recovered', candidate: { displayTitle: 'Recovered Movie' } },
        {
          status: 'unresolved_after_retries',
          candidate: { displayTitle: 'Unresolved Film', sourceUrl: 'https://new8.hdhub4u.cl/u1/' },
          attempts: 3,
          failureCategory: 'rejected_by_eligibility',
          rejectedReasons: [{ reason: 'greenmotors.club' }]
        }
      ];
      const runKey = 'HDHub4u_2026-10-16_test_run_1';
      const summary = mgr.generateNotificationSummary(runKey, batchResults);

      assert.strictEqual(summary.runKey, runKey);
      assert.strictEqual(summary.recoveredCount, 1);
      assert.strictEqual(summary.unresolvedCount, 1);
      assert.strictEqual(summary.recoveredTitles[0], 'Recovered Movie');
      assert.strictEqual(summary.unresolvedDetails[0].title, 'Unresolved Film');
      assert.strictEqual(summary.unresolvedDetails[0].failureCategory, 'rejected_by_eligibility');
    });

    // Test 9: Existing canonical records and IDs are strictly preserved
    runTest('Catalog preservation: VisionQuest (13697) and Rise of Skywalker (5207) maintain canonical IDs', () => {
      const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8'));
      const vq = cat.find(c => c.canonicalId === 13697);
      const sw9 = cat.find(c => c.canonicalId === 5207);

      assert.ok(vq, 'VisionQuest must exist with canonicalId 13697');
      assert.strictEqual(vq.type, 'Web Series');
      assert.ok(vq.variants && vq.variants.length > 0);

      assert.ok(sw9, 'Star Wars Episode IX must exist with canonicalId 5207');
      assert.strictEqual(sw9.type, 'Movie');
      assert.ok(sw9.variants && sw9.variants.length > 0);
    });

    console.log('='.repeat(75));
    console.log(`ALL ${passed}/${total} RETRY LOOP ACCEPTANCE CHECKS PASSED WITH 100% SUCCESS!`);
    console.log('='.repeat(75));
  } finally {
    if (fs.existsSync(TEST_STATE_PATH)) {
      try { fs.unlinkSync(TEST_STATE_PATH); } catch (e) {}
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
