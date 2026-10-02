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
  'test_details_experience.js'
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
