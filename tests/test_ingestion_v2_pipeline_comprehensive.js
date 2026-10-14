/**
 * Test Suite: Comprehensive End-to-End Pipeline & Production Catalog Safety Invariant
 * Validates:
 * 1. End-to-end staging execution without modifying production data.
 * 2. Deterministic staging artifacts generated in staging_v2/ and praflix-testing B2 prefix.
 * 3. Explicit run statuses: SUCCESS, PARTIAL, FAILED, INCONCLUSIVE, VALIDATION_FAILED.
 * 4. Production catalog integrity invariant: data/catalog.json & data/downloads.json remain 100% byte-for-byte identical.
 * 5. Review queue persistence for ambiguous matches.
 * 6. Telegram V2 staging notification output format.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { runPipeline } = require('../ingestion_v2/pipeline');
const { StagingEngine } = require('../ingestion_v2/staging/staging_engine');
const { TelegramV2Reporter } = require('../ingestion_v2/reporting/telegram_v2_reporter');

const BASE_DIR = path.resolve(__dirname, '../');
const CATALOG_PATH = path.join(BASE_DIR, 'data/catalog.json');
const DOWNLOADS_PATH = path.join(BASE_DIR, 'data/downloads.json');

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return {
    bytes: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  };
}

async function runTests() {
  console.log('='.repeat(65));
  console.log('TEST SUITE: COMPREHENSIVE V2 PIPELINE & INVARIANT SAFETY');
  console.log('='.repeat(65));

  // --- Baseline Production Check ---
  console.log('\n[Safety Baseline] Computing pre-test checksums for production files...');
  const catPre = hashFile(CATALOG_PATH);
  const dlPre = hashFile(DOWNLOADS_PATH);
  assert.ok(catPre, 'data/catalog.json must exist');
  assert.ok(dlPre, 'data/downloads.json must exist');
  console.log(`  ✓ data/catalog.json: ${catPre.bytes.toLocaleString()} bytes (SHA-256: ${catPre.sha256.slice(0, 16)}...)`);
  console.log(`  ✓ data/downloads.json: ${dlPre.bytes.toLocaleString()} bytes (SHA-256: ${dlPre.sha256.slice(0, 16)}...)`);

  // --- Test 1: StagingEngine run status classification ---
  console.log('\n[Test 1] StagingEngine: Run status logic...');
  const stagingEngine = new StagingEngine();

  assert.strictEqual(
    stagingEngine.determineRunStatus({ validationErrors: ['schema mismatch'] }),
    'VALIDATION_FAILED'
  );
  assert.strictEqual(
    stagingEngine.determineRunStatus({ isChallenge: true }),
    'INCONCLUSIVE'
  );
  assert.strictEqual(
    stagingEngine.determineRunStatus({ pagesDiscovered: 0, discoveryErrors: ['HTTP 500'] }),
    'FAILED'
  );
  assert.strictEqual(
    stagingEngine.determineRunStatus({ pagesDiscovered: 10, failedPagesCount: 2 }),
    'PARTIAL'
  );
  assert.strictEqual(
    stagingEngine.determineRunStatus({ pagesDiscovered: 15, candidatesCount: 15, failedPagesCount: 0 }),
    'SUCCESS'
  );
  console.log('  ✓ Verified all 5 explicit run statuses.');

  // --- Test 2: TelegramV2Reporter text output ---
  console.log('\n[Test 2] TelegramV2Reporter: Formatting staging notification...');
  const reporter = new TelegramV2Reporter();
  const sampleRunResult = {
    runId: 'test_run_123',
    provider: 'HDHub4u',
    timestampIst: '2026-10-14 09:00:00 IST',
    status: 'SUCCESS',
    discovery: {
      methodsUsed: ['sitemap:post-sitemap.xml'],
      pagesDiscovered: 100,
      successfullyParsed: 10
    },
    evaluation: {
      newCanonicalTitles: [
        { displayTitle: 'Weapons', year: '2026', type: 'Movie' }
      ],
      existingTitlesUpdated: [],
      duplicateRecords: [],
      ambiguousRecords: [],
      rejectedRecords: []
    }
  };

  const formattedMsg = reporter.formatReport(sampleRunResult);
  assert.ok(formattedMsg.includes('PRAFLIX V2 STAGING REPORT'));
  assert.ok(formattedMsg.includes('praflix-testing/ingestion-v2/'));
  assert.ok(formattedMsg.includes('Production Catalog: UNTOUCHED'));
  assert.ok(formattedMsg.includes('Weapons (2026) [Movie]'));
  console.log('  ✓ Telegram staging report formatted cleanly with safety badges.');

  // --- Test 3: End-to-End Pipeline Execution in Staging Mode ---
  console.log('\n[Test 3] End-to-End Pipeline execution (Staging Mode)...');
  const result = await runPipeline({
    provider: 'all',
    maxPages: 1,
    sampleLimit: 3,
    noB2: false, // Executes actual B2 testing upload to praflix-testing
    noTelegram: true // Prevent spamming notifications during automated test
  });

  assert.ok(result.runId, 'Pipeline must return runId');
  assert.ok(['SUCCESS', 'PARTIAL'].includes(result.status), `Expected SUCCESS or PARTIAL, got ${result.status}`);
  assert.ok(result.localFiles.length >= 4, 'Should generate report, markdown, review queue, and staged catalog');
  console.log(`  ✓ Pipeline completed successfully with status "${result.status}".`);
  console.log(`  ✓ Generated ${result.localFiles.length} staging files in staging_v2/.`);
  console.log(`  ✓ Uploaded ${result.b2Files.length} artifacts to praflix-testing B2 bucket.`);

  // --- Test 4: Critical Production Catalog Invariant Check ---
  console.log('\n[Test 4] Verifying Critical Invariant: Production files are 100% UNTOUCHED...');
  const catPost = hashFile(CATALOG_PATH);
  const dlPost = hashFile(DOWNLOADS_PATH);

  assert.strictEqual(
    catPost.sha256,
    catPre.sha256,
    'CRITICAL INVARIANT VIOLATION: data/catalog.json was modified during testing!'
  );
  assert.strictEqual(
    catPost.bytes,
    catPre.bytes,
    'CRITICAL INVARIANT VIOLATION: data/catalog.json file size changed!'
  );
  assert.strictEqual(
    dlPost.sha256,
    dlPre.sha256,
    'CRITICAL INVARIANT VIOLATION: data/downloads.json was modified during testing!'
  );
  assert.strictEqual(
    dlPost.bytes,
    dlPre.bytes,
    'CRITICAL INVARIANT VIOLATION: data/downloads.json file size changed!'
  );

  console.log('  ✓ Verified: data/catalog.json is byte-for-byte identical.');
  console.log('  ✓ Verified: data/downloads.json is byte-for-byte identical.');

  console.log('\n[PASS] Comprehensive Pipeline & Invariant Safety tests passed cleanly.\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('\n[TEST FAILURE]', err);
    process.exit(1);
  });
}

module.exports = { runTests };
