#!/usr/bin/env node
/**
 * PRAFLIX — Post-Validation Telegram Report Dispatcher
 * A PRAVERSE Company
 *
 * Dispatches the validated daily catalog synchronization report to Telegram
 * ONLY after all integrity checks, production build, and acceptance tests
 * have completely succeeded.
 */

const fs = require('fs');
const path = require('path');
const { sendTelegramReport } = require('./sync_core');

const BASE_DIR = path.dirname(__dirname);
const REPORT_PATH = path.join(BASE_DIR, 'data', '.sync-report.json');

async function main() {
  console.log('='.repeat(65));
  console.log('PRAFLIX — POST-VALIDATION TELEGRAM REPORT DISPATCHER');
  console.log('='.repeat(65));

  if (!fs.existsSync(REPORT_PATH)) {
    console.log('[NOTICE] No pending sync report found in data/.sync-report.json. Nothing to dispatch.');
    return;
  }

  const reportData = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const reportText = reportData.reportText;

  if (!reportText) {
    console.warn('[WARN] Sync report file exists but contains no reportText.');
    return;
  }

  console.log('Dispatching final validated PRAFLIX REPORT to Telegram channel...');
  const result = await sendTelegramReport(reportText);

  if (result.success) {
    console.log('✓ Validated Telegram report successfully delivered.');
  } else {
    console.warn(`⚠️ Telegram dispatch notice: ${result.error}`);
  }

  console.log('='.repeat(65));
}

main().catch(err => {
  console.error('[ERROR] Telegram dispatch runner error:', err.message);
  // Do not fail the CI job if Telegram API encounters a transient network hiccup
});
