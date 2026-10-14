#!/usr/bin/env node
/**
 * PRAFLIX — 24-Hour Catalog Synchronization & Telegram Runner
 * A PRAVERSE Company
 *
 * Usage:
 *   node scripts/sync_catalog.js [--dry-run] [--no-telegram]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runFullSync, sendTelegramReport } = require('./sync_core');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const SOURCES_PATH = path.join(DATA_DIR, 'source-records.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const skipTelegram = args.includes('--no-telegram');

let targetProvider = null;
const provIdx = args.indexOf('--provider');
if (provIdx !== -1 && args[provIdx + 1]) {
  targetProvider = args[provIdx + 1].trim();
}

if (targetProvider && (targetProvider.toLowerCase() === '10moviez' || targetProvider.toLowerCase() === 'hdwall')) {
  console.log('='.repeat(65));
  console.log('PRAFLIX — 24-HOUR AUTOMATED CATALOG SYNCHRONIZATION');
  console.log('='.repeat(65));
  console.log(`\n[RETIRED SOURCE] Provider "${targetProvider}" has been officially retired as an active content source.`);
  console.log(`[RETIRED SOURCE] Automated crawling, scheduled jobs, and imports for "${targetProvider}" are permanently disabled.`);
  console.log(`[RETIRED SOURCE] All existing historical download links and canonical catalog entries are preserved intact.`);
  console.log(`[RETIRED SOURCE] Ingestion halted safely with zero changes.`);
  process.exit(0);
}

async function main() {
  console.log('='.repeat(65));
  console.log('PRAFLIX — 24-HOUR AUTOMATED CATALOG SYNCHRONIZATION');
  console.log('='.repeat(65));

  if (!fs.existsSync(CATALOG_PATH) || !fs.existsSync(SOURCES_PATH)) {
    console.error('[ERROR] Catalog or source records not found.');
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const sourceRecords = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));

  const initialCount = catalog.length;
  console.log(`Current catalog size: ${initialCount.toLocaleString()} titles`);

  const providerLabel = targetProvider && targetProvider.toLowerCase() !== 'all'
    ? `provider: ${targetProvider}`
    : 'provider: HDHub4u (active; 10Moviez & HDWall retired)';
  console.log(`\n[1/3] Synchronizing ${providerLabel}...`);
  const { summary, reportText, totalAdded, totalUpdated } = await runFullSync(catalog, sourceRecords, {
    provider: targetProvider,
    dryRun: isDryRun
  });

  console.log('\n[2/3] Sync completed. Results summary:');
  console.log(`- New Movies Added: ${summary.totals.moviesAdded}`);
  console.log(`- New Series Added: ${summary.totals.seriesAdded}`);
  console.log(`- Total Titles Added: ${summary.totals.totalTitlesAdded}`);
  console.log(`- Existing Titles Updated: ${summary.totals.titlesUpdated}`);
  console.log(`- Title List Entries Appended: ${summary.totals.titleListAppended || 0}`);
  console.log(`- Final catalog size: ${catalog.length.toLocaleString()}`);

  const REPORT_PATH = path.join(DATA_DIR, '.sync-report.json');
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    summary,
    reportText,
    totalAdded,
    totalUpdated,
    timestamp: new Date().toISOString()
  }, null, 2), 'utf8');

  const providerEntries = Object.values(summary.providers);
  const failedProviders = providerEntries.filter(p => p.failed);
  const allProvidersFailed = providerEntries.length > 0 && failedProviders.length === providerEntries.length;
  const isSingleProviderRun = Boolean(targetProvider && targetProvider.toLowerCase() !== 'all');

  // Handle single-provider and all-provider failures explicitly:
  // A blocked crawl (HTTP 403, 5xx, or network failure) must NOT be misrepresented as a successful scan,
  // and deployment must be blocked when the targeted crawl fails.
  if (isSingleProviderRun && failedProviders.length > 0) {
    const failedP = failedProviders[0];
    console.error(`\n[FATAL] Provider "${targetProvider}" sync failed or was blocked: ${failedP.error || 'Unknown error'}`);
    console.error('[FATAL] Aborting pipeline to prevent false success and block invalid edge deployment.');
    if (!skipTelegram && !deferTelegram) {
      console.log('Dispatching failure report to Telegram...');
      await sendTelegramReport(reportText);
    }
    throw new Error(`CRITICAL: Provider "${targetProvider}" failed during synchronization (${failedP.error}). Workflow halted to block deployment.`);
  }

  if (allProvidersFailed) {
    console.error(`\n[FATAL] Complete sync failure: all requested providers (${providerEntries.length}) failed to synchronize.`);
    if (!skipTelegram && !deferTelegram) {
      console.log('Dispatching complete failure alert to Telegram...');
      await sendTelegramReport(reportText);
    }
    throw new Error(`CRITICAL: All ${providerEntries.length} requested providers failed during synchronization. Workflow halted to prevent deployment.`);
  }

  if (catalog.length < initialCount) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: Catalog count decreased from ${initialCount} to ${catalog.length}. Aborting to protect catalog integrity.`);
  }

  const totalTitleListAppended = summary.totals.titleListAppended || 0;
  const hasModifications = (totalAdded > 0) || (totalUpdated > 0) || (totalTitleListAppended > 0);

  if (!isDryRun && hasModifications) {
    console.log('\nPersisting updated catalog and source records...');
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
    fs.writeFileSync(SOURCES_PATH, JSON.stringify(sourceRecords, null, 2), 'utf8');

    console.log('Rebuilding production assets & chunks via build.js...');
    try {
      execFileSync(process.execPath, [path.join(BASE_DIR, 'build.js')], { stdio: 'inherit' });
    } catch (bErr) {
      console.error('[ERROR] Build step failed:', bErr.message);
      throw bErr;
    }
  } else if (isDryRun) {
    console.log('\n[DRY RUN] Catalog files left untouched.');
  } else {
    console.log('\nNo catalog modifications required today.');
  }

  // Telegram Report Dispatch
  console.log('\n[3/3] Telegram Dispatch...');
  const deferTelegram = args.includes('--defer-telegram');
  if (deferTelegram) {
    console.log('[DEFERRED] Telegram report dispatch deferred to post-validation step in workflow.');
    console.log('\nGenerated Report Preview:');
    console.log(reportText);
  } else if (skipTelegram) {
    console.log('[SKIP] Telegram report skipped via --no-telegram flag.');
    console.log('\nGenerated Report:');
    console.log(reportText);
  } else {
    console.log('Dispatching daily report to Telegram channel...');
    const tgResult = await sendTelegramReport(reportText);
    if (tgResult.success) {
      console.log('✓ Telegram report successfully delivered.');
    } else {
      console.warn(`⚠️ Telegram dispatch notice: ${tgResult.error}`);
    }
  }

  console.log('\n' + '='.repeat(65));
  console.log('PRAFLIX 24-HOUR SYNC OPERATION FINISHED');
  console.log('='.repeat(65));
}

main().catch(err => {
  console.error('[FATAL] Sync runner error:', err.message);
  process.exit(1);
});
