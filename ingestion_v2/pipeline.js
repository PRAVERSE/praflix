#!/usr/bin/env node
/**
 * PRAFLIX Ingestion Pipeline V2 — Unified Pipeline Runner
 * A PRAVERSE Company
 *
 * Usage:
 *   node ingestion_v2/pipeline.js [--provider <hdhub4u|10moviez|hdwall|all>] [--max-pages 2] [--no-b2] [--dry-run]
 *
 * Strict Isolation Guarantees:
 * - Reads master data/catalog.json in strictly read-only mode.
 * - Staging outputs written ONLY to local staging_v2/ and praflix-testing bucket.
 * - Never modifies production catalog, downloads, chunks, or deployment triggers.
 */

const fs = require('fs');
const path = require('path');

const { loadTestingConfig } = require('./config/env_loader');
const { B2TestingClient } = require('./storage/b2_test_client');
const { HDHub4uV2Adapter } = require('./adapters/hdhub4u_v2_adapter');
const { TenMoviezV2Adapter } = require('./adapters/tenmoviez_v2_adapter');
const { HDWallV2Adapter } = require('./adapters/hdwall_v2_adapter');
const { Normalizer } = require('./normalization/normalizer');
const { MatchingEngine } = require('./matching/matching_engine');
const { StagingEngine } = require('./staging/staging_engine');
const { TelegramV2Reporter } = require('./reporting/telegram_v2_reporter');

const BASE_DIR = path.resolve(__dirname, '../');
const MASTER_CATALOG_PATH = path.join(BASE_DIR, 'data/catalog.json');

async function runPipeline(options = {}) {
  const provider = (options.provider || 'all').toLowerCase();
  const maxPages = options.maxPages || 2;
  const skipB2 = Boolean(options.noB2);
  const skipTelegram = Boolean(options.noTelegram);

  console.log('='.repeat(70));
  console.log('PRAFLIX INGESTION PIPELINE V2 — INDEPENDENT STAGING RUNNER');
  console.log('A PRAVERSE Company');
  console.log('='.repeat(70));
  console.log(`[Config] Target Provider: ${provider}`);
  console.log(`[Config] Max Pages per listing: ${maxPages}`);
  console.log(`[Config] B2 Testing Bucket Target: praflix-testing`);
  console.log(`[Config] Production Safety: Guaranteed Isolated`);

  // 1. Verify and load testing configuration
  const testingConfig = loadTestingConfig();
  console.log(`\n[1/6] Validated testing configuration: bucket "${testingConfig.b2.bucketName}" confirmed.`);

  // 2. Initialize B2 Testing Client
  let b2Client = null;
  if (!skipB2) {
    try {
      b2Client = new B2TestingClient(testingConfig.b2);
      await b2Client.authorize();
      console.log(`[2/6] B2 Testing Client authorized against: ${testingConfig.b2.bucketName}`);
    } catch (err) {
      console.warn(`[2/6] B2 Client notice: ${err.message}. Proceeding with local staging.`);
    }
  } else {
    console.log(`[2/6] B2 upload skipped via --no-b2 flag.`);
  }

  // 3. Load existing master catalog (Strictly Read-Only)
  if (!fs.existsSync(MASTER_CATALOG_PATH)) {
    throw new Error(`Master catalog not found at: ${MASTER_CATALOG_PATH}`);
  }
  const existingCatalog = JSON.parse(fs.readFileSync(MASTER_CATALOG_PATH, 'utf8'));
  console.log(`[3/6] Loaded ${existingCatalog.length.toLocaleString()} master canonical titles for read-only matching.`);

  const normalizer = new Normalizer();
  const matchingEngine = new MatchingEngine(existingCatalog);
  const stagingEngine = new StagingEngine({ b2Client });
  const telegramReporter = new TelegramV2Reporter(testingConfig.telegram);

  // 4. Select and run provider adapters (HDHub4u is active; 10Moviez and HDWall are retired)
  const adaptersToRun = [];
  if (provider === 'all' || provider === 'hdhub4u') {
    adaptersToRun.push(new HDHub4uV2Adapter());
  }
  if (provider === '10moviez' || provider === 'hdwall') {
    console.log(`[RETIRED SOURCE] Provider "${provider}" is officially retired. Ingestion pipeline V2 will not crawl or import from this source.`);
  }

  const allNormalizedCandidates = [];
  const discoverySummary = {
    methodsUsed: [],
    pagesDiscovered: 0,
    successfullyParsed: 0,
    failedPages: []
  };

  console.log(`\n[4/6] Executing multi-vector discovery across ${adaptersToRun.length} provider(s)...`);

  for (const adapter of adaptersToRun) {
    console.log(`\n--> Discovering from ${adapter.displayName}...`);
    try {
      const discResult = await adapter.discover({ maxPages });
      discoverySummary.methodsUsed.push(...discResult.methodsUsed);
      discoverySummary.pagesDiscovered += discResult.candidates.length;
      console.log(`    Found ${discResult.candidates.length} candidate URLs via [${discResult.methodsUsed.join(', ')}]`);

      // For sample / latest candidate items, parse detail pages or use candidate metadata
      let parsedForProvider = 0;
      // Inspect first 15 candidates per provider to respect rate limits and perform quick staging verification
      const sampleLimit = options.sampleLimit || 15;
      const candidatesToProcess = discResult.candidates.slice(0, sampleLimit);

      for (const cand of candidatesToProcess) {
        let item = null;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(cand.url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const html = await res.text();
            item = adapter.parseDetailPage(html, cand.url);
          }
        } catch (_) {}

        // Fallback to basic metadata if detail page fetch was unavailable
        if (!item && cand.rawTitle) {
          item = {
            provider: adapter.displayName,
            originalSourceTitle: cand.rawTitle,
            sourceUrl: cand.url,
            sourcePosterUrl: cand.posterUrl,
            downloadLinks: []
          };
        }

        if (item) {
          const normalized = normalizer.normalizeRecord(item);
          if (normalized) {
            allNormalizedCandidates.push(normalized);
            parsedForProvider++;
          }
        }
      }

      discoverySummary.successfullyParsed += parsedForProvider;
      console.log(`    Parsed and normalized ${parsedForProvider} records from ${adapter.displayName}.`);
    } catch (err) {
      console.error(`    [ERROR] Discovery failed for ${adapter.displayName}: ${err.message}`);
      discoverySummary.failedPages.push({ provider: adapter.displayName, reason: err.message });
    }
  }

  // 5. Hierarchical Matching & Deduplication
  console.log(`\n[5/6] Evaluating ${allNormalizedCandidates.length} candidate record(s) with Matching Engine...`);
  const evaluation = matchingEngine.evaluateBatch(allNormalizedCandidates);

  console.log(`    - New Canonical Titles: ${evaluation.newCanonicalTitles.length}`);
  console.log(`    - Existing Titles Updated: ${evaluation.existingTitlesUpdated.length}`);
  console.log(`    - Duplicate Records: ${evaluation.duplicateRecords.length}`);
  console.log(`    - Ambiguous Records (Review Queue): ${evaluation.ambiguousRecords.length}`);
  console.log(`    - Invalid / Rejected: ${evaluation.rejectedRecords.length}`);

  // 6. Staging Generation & B2 Upload
  console.log(`\n[6/6] Generating staging artifacts and uploading to praflix-testing...`);
  const runId = `v2_run_${Date.now()}`;
  const stagingResult = await stagingEngine.stageRun({
    runId,
    provider,
    discovery: discoverySummary,
    evaluation
  });

  console.log(`✓ Staging completed with status: ${stagingResult.status}`);
  console.log(`✓ Local staging artifacts created in: staging_v2/`);
  stagingResult.localFiles.forEach(f => console.log(`   - ${path.basename(f)}`));

  if (stagingResult.b2Files.length > 0) {
    console.log(`✓ B2 testing artifacts uploaded to praflix-testing:`);
    stagingResult.b2Files.forEach(f => console.log(`   - ${f}`));
  }

  // Dispatch Telegram Staging Report if enabled
  if (!skipTelegram && testingConfig.telegram.isConfigured) {
    console.log(`\n[Telegram] Dispatching V2 staging notification...`);
    const teleRes = await telegramReporter.sendReport({
      runId,
      provider,
      timestampIst: stagingResult.timestampIst,
      status: stagingResult.status,
      discovery: discoverySummary,
      evaluation
    });
    if (teleRes.success && !teleRes.skipped) {
      console.log(`✓ Telegram notification dispatched successfully.`);
    } else if (teleRes.skipped) {
      console.log(`ℹ️ Telegram notification skipped: ${teleRes.reason}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('PRAFLIX V2 STAGING EXECUTION COMPLETE');
  console.log('Production catalog remained 100% untouched.');
  console.log('='.repeat(70));

  return stagingResult;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    provider: 'all',
    maxPages: 2,
    noB2: args.includes('--no-b2'),
    noTelegram: args.includes('--no-telegram')
  };

  const provIdx = args.indexOf('--provider');
  if (provIdx !== -1 && args[provIdx + 1]) {
    options.provider = args[provIdx + 1].trim();
  }

  const pageIdx = args.indexOf('--max-pages');
  if (pageIdx !== -1 && args[pageIdx + 1]) {
    options.maxPages = parseInt(args[pageIdx + 1], 10) || 2;
  }

  runPipeline(options)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n[FATAL PIPELINE ERROR]', err.message);
      process.exit(1);
    });
}

module.exports = {
  runPipeline
};
