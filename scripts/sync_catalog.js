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

  console.log('\n[1/3] Synchronizing providers: HDHub4u, 10Moviez, HDWall...');
  const { summary, reportText, totalAdded, totalUpdated } = await runFullSync(catalog, sourceRecords);

  console.log('\n[2/3] Sync completed. Results summary:');
  console.log(`- New Movies Added: ${summary.totals.moviesAdded}`);
  console.log(`- New Series Added: ${summary.totals.seriesAdded}`);
  console.log(`- Total Titles Added: ${summary.totals.totalTitlesAdded}`);
  console.log(`- Existing Titles Updated: ${summary.totals.titlesUpdated}`);
  console.log(`- Final catalog size: ${catalog.length.toLocaleString()}`);

  const providerEntries = Object.values(summary.providers);
  const failedProviders = providerEntries.filter(p => p.failed);
  const allProvidersFailed = providerEntries.length > 0 && failedProviders.length === providerEntries.length;

  if (allProvidersFailed) {
    console.error('\n[FATAL] Complete sync failure: all providers failed to synchronize.');
    if (!skipTelegram) {
      console.log('Dispatching complete failure alert to Telegram...');
      await sendTelegramReport(reportText);
    }
    throw new Error(`CRITICAL: All ${providerEntries.length} providers failed during synchronization. Workflow halted to prevent deployment.`);
  }

  if (catalog.length < initialCount) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: Catalog count decreased from ${initialCount} to ${catalog.length}. Aborting to protect catalog integrity.`);
  }

  const hasModifications = (totalAdded > 0) || (totalUpdated > 0);

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

  const REPORT_PATH = path.join(DATA_DIR, '.sync-report.json');
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    summary,
    reportText,
    totalAdded,
    totalUpdated,
    timestamp: new Date().toISOString()
  }, null, 2), 'utf8');

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
