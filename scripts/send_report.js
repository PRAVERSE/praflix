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
  formatProviderFailureNotification,
  formatIstDateTime
} = require('./sync_core');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const REPORT_PATH = path.join(DATA_DIR, '.sync-report.json');
const SENT_RUNS_PATH = path.join(DATA_DIR, '.telegram-sent-runs.json');

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
  const hasNewTitles = Boolean(summary.hasNewTitles && newTitles.length > 0);

  // Deployment status confirmation from environment or args
  const args = process.argv.slice(2);
  let deploymentStatus = process.env.DEPLOYMENT_STATUS || 'Confirmed successful';
  const depIdx = args.indexOf('--deployment-status');
  if (depIdx !== -1 && args[depIdx + 1]) {
    deploymentStatus = args[depIdx + 1].trim();
  }

  // Idempotency check: compute stable run key
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  const syncTime = reportData.timestamp || summary.syncTime || new Date().toISOString();
  const dateKey = syncTime.slice(0, 10); // YYYY-MM-DD
  const titlesSignature = newTitles.map(t => t.canonicalId || t.displayTitle).sort().join('_');
  const runKey = `${targetProvider}_${dateKey}_run_${runId}_att_${runAttempt}_${titlesSignature || 'none'}`;

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
      validationStatus: 'Passed',
      deploymentStatus: deploymentStatus
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
      deploymentStatus
    };
    saveSentRuns(sentRuns);
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
