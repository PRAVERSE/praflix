#!/usr/bin/env node
/**
 * PRAFLIX — Portable Frontend Test Runner
 * Cross-platform runner for test_frontend_all_years.js and test_details_experience.js
 * Compatible with Windows PowerShell, Windows cmd.exe, and Linux/macOS bash.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const tests = [
  'test_frontend_all_years.js',
  'test_details_experience.js',
  path.join('tests', 'test_sync_and_telegram.js'),
  path.join('tests', 'smoke_test_dom.js'),
  path.join('tests', 'test_available_versions_download_mapping.js'),
  path.join('tests', 'test_hdhub4u_catalog_sync.js'),
  path.join('tests', 'test_download_verification_repair.js'),
  path.join('tests', 'test_problem9_audit_and_posters.js'),
  path.join('tests', 'test_problem10_production_verification.js'),
  path.join('tests', 'test_problem11_poster_and_download_verification.js'),
  path.join('tests', 'test_problem12_recovery.js'),
  path.join('tests', 'test_workflow_persistence.js')
];

let failed = false;

for (const testFile of tests) {
  console.log(`\n>>> Running: ${testFile} ...`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, testFile)], {
      stdio: 'inherit'
    });
  } catch (err) {
    console.error(`\n[FAIL] Test suite failed: ${testFile}`);
    failed = true;
    break;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('\n[PASS] All frontend test suites completed successfully.');
  process.exit(0);
}
