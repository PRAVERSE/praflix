#!/usr/bin/env node
/**
 * PRAFLIX — Post-Deployment Telegram Report Dispatcher
 * A PRAVERSE Company
 *
 * Dispatches the validated daily catalog report or dedicated
 * "PRAFLIX — NEW TITLES ADDED" notification to Telegram ONLY after:
 * 1. All integrity validations have passed.
 * 2. Production build is successful.
 * 3. Changes are committed to catalog.
 * 4. Deployment is confirmed successful (or accurately reported).
 *
 * Implements idempotency to prevent duplicate notifications on workflow retries.
 */

const fs = require('fs');
const path = require('path');
const {
  sendTelegramReport,
  formatNewTitlesTelegramReport,
  formatExistingTitlesUpdatedReport,
  formatIncompleteImportsWarning,
  formatProviderFailureNotification,
  formatIstDateTime
} = require('./sync_core');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const REPORT_PATH = path.join(DATA_DIR, '.sync-report.json');
const SENT_RUNS_PATH = path.join(DATA_DIR, 'telegram_sent_runs.json');

function loadSentRuns() {
  if (fs.existsSync(SENT_RUNS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(SENT_RUNS_PATH, 'utf8'));
    } catch (_) {
      return {};
    }
  }
  return {};
}

function saveSentRuns(sentRuns) {
  try {
    fs.writeFileSync(SENT_RUNS_PATH, JSON.stringify(sentRuns, null, 2), 'utf8');
  } catch (err) {
    console.warn('[WARN] Failed to persist sent runs ledger:', err.message);
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log('PRAFLIX — POST-DEPLOYMENT TELEGRAM NOTIFICATION DISPATCHER');
  console.log('='.repeat(65));

  if (!fs.existsSync(REPORT_PATH)) {
    console.log('[NOTICE] No pending sync report found in data/.sync-report.json. Nothing to dispatch.');
    return;
  }

  const reportData = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const summary = reportData.summary || {};
  const targetProvider = summary.targetProvider || 'HDHub4u';
  const newTitles = summary.newCanonicalTitles || [];
  const existingUpdated = summary.existingTitlesUpdated || [];
  const hasNewTitles = Boolean(summary.hasNewTitles && newTitles.length > 0);
  const hasExistingUpdated = Boolean(existingUpdated.length > 0);
  const newLinksCount = (summary.newProviderLinks || []).length;
  const titleListAppendedCount = (summary.titleListEntriesAppended || []).length;
  const duplicateLinksSkippedCount = typeof summary.duplicateLinksSkipped === 'number'
    ? summary.duplicateLinksSkipped
    : (summary.duplicateLinksSkipped || []).length;

  // Deployment status confirmation from environment or args
  const args = process.argv.slice(2);
  let deploymentStatus = process.env.DEPLOYMENT_STATUS || 'Confirmed successful';
  const depIdx = args.indexOf('--deployment-status');
  if (depIdx !== -1 && args[depIdx + 1]) {
    deploymentStatus = args[depIdx + 1].trim();
  }

  // Idempotency check: compute stable run key across workflow retries
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const syncTime = reportData.timestamp || summary.syncTime || new Date().toISOString();
  const dateKey = syncTime.slice(0, 10); // YYYY-MM-DD
  const titlesSignature = newTitles.map(t => t.canonicalId || t.displayTitle).sort().join('_');
  const runKey = `${targetProvider}_${dateKey}_run_${runId}_${titlesSignature || 'none'}`;

  const sentRuns = loadSentRuns();
  if (sentRuns[runKey] && sentRuns[runKey].sent) {
    console.log(`[IDEMPOTENT] Notification for key "${runKey}" was already dispatched at ${sentRuns[runKey].sentAt}.`);
    console.log('Skipping duplicate Telegram dispatch on workflow retry.');
    return;
  }

  // Determine report text
  let finalMessage = '';
  const providerEntries = Object.values(summary.providers || {});
  const allFailed = providerEntries.length > 0 && providerEntries.every(p => p.failed);
  const targetProviderObj = summary.providers ? summary.providers[targetProvider] : null;

  if (targetProviderObj && targetProviderObj.failed) {
    // Single provider failure
    finalMessage = formatProviderFailureNotification({
      provider: targetProvider,
      runTime: summary.runTimeIst || formatIstDateTime(new Date()),
      error: targetProviderObj.error,
      inconclusive: false,
      deploymentStatus: deploymentStatus === 'Confirmed successful' ? 'Aborted (sync failed)' : deploymentStatus
    });
  } else if (allFailed) {
    // Complete failure
    finalMessage = formatProviderFailureNotification({
      provider: targetProvider,
      runTime: summary.runTimeIst || formatIstDateTime(new Date()),
      error: 'All requested providers failed to synchronize.',
      inconclusive: true,
      deploymentStatus: 'Aborted (all providers failed)'
    });
  } else if (hasNewTitles) {
    // Dedicated PRAFLIX — NEW TITLES ADDED format
    finalMessage = formatNewTitlesTelegramReport({
      provider: targetProvider,
      runTime: summary.runTimeIst || formatIstDateTime(new Date()),
      newTitles: newTitles,
      existingUpdated: existingUpdated,
      newProviderLinksCount: newLinksCount,
      titleListAppendedCount: titleListAppendedCount,
      incompleteTitles: summary.incompleteTitles || [],
      duplicateLinksSkippedCount: duplicateLinksSkippedCount,
      validationStatus: 'Passed',
      deploymentStatus: deploymentStatus
    });
  } else if (hasExistingUpdated) {
    // Dedicated PRAFLIX — EXISTING TITLES UPDATED WITH NEW LINKS format
    finalMessage = formatExistingTitlesUpdatedReport({
      provider: targetProvider,
      runTime: summary.runTimeIst || formatIstDateTime(new Date()),
      existingUpdated: existingUpdated,
      newProviderLinksCount: newLinksCount,
      incompleteTitles: summary.incompleteTitles || [],
      duplicateLinksSkippedCount: duplicateLinksSkippedCount,
      validationStatus: 'Passed',
      deploymentStatus: deploymentStatus
    });
  } else if (summary.incompleteTitles && summary.incompleteTitles.length > 0) {
    // Incomplete imports warning: zero new titles added because downloads missing
    finalMessage = formatIncompleteImportsWarning({
      provider: targetProvider,
      runTime: summary.runTimeIst || formatIstDateTime(new Date()),
      incompleteTitles: summary.incompleteTitles,
      validationStatus: 'Passed (Catalog Protected)',
      deploymentStatus: deploymentStatus === 'Confirmed successful' ? 'Catalog Verified' : deploymentStatus
    });
  } else {
    // Standard daily report format (with confirmed deployment status)
    finalMessage = reportData.reportText || '';
    if (deploymentStatus && !finalMessage.includes(`Deployment: ${deploymentStatus}`)) {
      finalMessage = finalMessage.replace(/🚀 Edge Deployment: .*/, `🚀 Edge Deployment: ${deploymentStatus}`);
    }
  }

  console.log('\nPrepared Telegram Message:');
  console.log('-'.repeat(50));
  console.log(finalMessage);
  console.log('-'.repeat(50));

  console.log(`\nDispatching notification to Telegram channel (Run key: ${runKey})...`);
  const result = await sendTelegramReport(finalMessage);

  if (result.success) {
    console.log('✓ Telegram notification successfully delivered.');
    sentRuns[runKey] = {
      sent: true,
      sentAt: new Date().toISOString(),
      provider: targetProvider,
      newTitlesCount: newTitles.length,
      existingUpdatedCount: existingUpdated.length,
      deploymentStatus
    };
    saveSentRuns(sentRuns);

    // Persist ledger under GitHub Actions if repo credentials are active
    if (process.env.GITHUB_ACTIONS && process.env.GITHUB_REF_NAME) {
      try {
        const { execSync } = require('child_process');
        execSync('git config user.name "PRAFLIX Automated Sync Bot" && git config user.email "bot@praflix.us.ci"');
        execSync('git add data/telegram_sent_runs.json');
        execSync('git commit -m "chore(sync): update telegram idempotency ledger [skip ci]" || true');
        execSync(`git pull --rebase --autostash origin ${process.env.GITHUB_REF_NAME} || true`);
        execSync(`git push origin ${process.env.GITHUB_REF_NAME} || true`);
      } catch (gitErr) {
        console.warn('[WARN] Could not git-push telegram ledger:', gitErr.message);
      }
    }
  } else {
    console.warn(`⚠️ Telegram dispatch notice: ${result.error}`);
    console.warn('Catalog modifications and deployment are preserved. Notification failure safely logged.');
    sentRuns[runKey] = {
      sent: false,
      lastError: result.error,
      attemptedAt: new Date().toISOString()
    };
    saveSentRuns(sentRuns);
  }

  console.log('='.repeat(65));
}

if (require.main === module) {
  main().catch(err => {
    console.error('[ERROR] Telegram dispatch runner error:', err.message);
    // Never fail workflow on Telegram network error per Rule 13
  });
}

module.exports = { main, loadSentRuns, saveSentRuns };
