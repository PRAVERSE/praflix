/**
 * PRAFLIX — Verification Test for GitHub Actions Workflow Persistence
 * Tests Step 7: "Persist Catalog & Source Records to Repository"
 * A PRAVERSE Company
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'daily-sync.yml');

console.log('='.repeat(70));
console.log('PRAFLIX — GITHUB ACTIONS CATALOG PERSISTENCE VERIFICATION');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${name} — PASSED`);
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${name} — FAILED: ${err.message}`);
    throw err;
  }
}

// 1. Workflow file exists and contains Step 7
runTest('Workflow file exists and defines step 7', () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), 'daily-sync.yml must exist');
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  assert.ok(content.includes('7. Persist Catalog & Source Records to Repository'), 'Step 7 must exist');
});

// 2. Erroneous pathspecs completely eliminated
runTest('Nonexistent pathspecs are completely removed from step 7', () => {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  assert.ok(!content.includes('catalog.csv'), 'catalog.csv must not be present');
  assert.ok(!content.includes('catalog-normalized.json'), 'catalog-normalized.json must not be present');
  assert.ok(!content.includes('poster-index.json'), 'poster-index.json must not be present');
});

// 3. Step 7 contains diagnostic missing-file validation
runTest('Step 7 contains diagnostic check with path and working directory', () => {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  assert.ok(content.includes('REQUIRED_FILES=('), 'Must define REQUIRED_FILES array');
  assert.ok(content.includes('::error::Required generated catalog file missing'), 'Must emit GitHub Actions error diagnostic');
  assert.ok(content.includes('$(pwd)'), 'Must include working directory in diagnostic');
});

// 4. All files in REQUIRED_FILES actually exist in the repository
runTest('All files declared in REQUIRED_FILES exist on disk', () => {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const match = content.match(/REQUIRED_FILES=\(\s*([\s\S]*?)\s*\)/);
  assert.ok(match, 'Must match REQUIRED_FILES block');
  
  const files = match[1]
    .split('\n')
    .map(line => line.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  assert.ok(files.length >= 10, `Expected at least 10 required files, found ${files.length}`);

  for (const relPath of files) {
    const fullPath = path.join(ROOT_DIR, relPath);
    assert.ok(fs.existsSync(fullPath), `Required file must exist on disk: ${relPath}`);
    assert.ok(fs.statSync(fullPath).size > 0, `Required file must not be empty: ${relPath}`);
  }
});

// 5. Git add stages actual files without pathspec errors and reproduces exit code 128 on bad paths
runTest('Git add command succeeds with exit code 0 when staging catalog files', () => {
  const validCmd = 'git add data/catalog.json data/source-records.json data/catalog-manifest.json data/catalog-chunk-*.json data/catalog_chunk_*.js data/downloads.json data/poster-valid-ids.js';
  // Valid command must exit with code 0
  assert.doesNotThrow(() => {
    execSync(validCmd, { cwd: ROOT_DIR, stdio: 'pipe' });
  }, 'git add with valid catalog pathspecs must exit with 0');

  // Conversely, verifying that the old pathspec triggers exit code 128
  assert.throws(() => {
    execSync('git add data/catalog.csv', { cwd: ROOT_DIR, stdio: 'pipe' });
  }, err => {
    return err.status === 128 && err.stderr.toString().includes('did not match any files');
  }, 'git add with data/catalog.csv must reproduce exit code 128');

  // Verify staging detection with a temporary metadata comment
  const manifestPath = path.join(ROOT_DIR, 'data', 'catalog-manifest.json');
  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  try {
    fs.writeFileSync(manifestPath, originalManifest + '\n', 'utf8');
    execSync(validCmd, { cwd: ROOT_DIR, stdio: 'pipe' });
    const staged = execSync('git diff --staged --name-only', { cwd: ROOT_DIR, encoding: 'utf8' });
    assert.ok(staged.includes('data/catalog-manifest.json'), 'Staged files must capture modified catalog-manifest.json');
  } finally {
    fs.writeFileSync(manifestPath, originalManifest, 'utf8');
    execSync('git restore --staged data/catalog-manifest.json', { cwd: ROOT_DIR, stdio: 'pipe' });
  }
});

// 6. Workflow trigger and deployment configuration preserved
runTest('Workflow triggers, concurrency, and Cloudflare deployment steps are preserved', () => {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  assert.ok(content.includes("cron: '0 0 * * *'"), 'Daily cron schedule preserved');
  assert.ok(content.includes('workflow_dispatch:'), 'workflow_dispatch manual trigger preserved');
  assert.ok(content.includes('concurrency:'), 'Concurrency group preserved');
  assert.ok(content.includes('contents: write'), 'Contents write permission preserved');
  assert.ok(content.includes('npx wrangler deploy'), 'Wrangler deployment step preserved');
});

console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} WORKFLOW PERSISTENCE TESTS PASSED!`);
console.log('='.repeat(70));
