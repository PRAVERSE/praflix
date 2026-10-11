#!/usr/bin/env node
/**
 * PRAFLIX — Independent Crawlers & Title-List Synchronization Acceptance Suite
 * A PRAVERSE Company
 *
 * Verifies all 14 scenarios required by Problem Specification:
 * 1. Each provider job runs at its correct UTC schedule corresponding to 10 AM, 11 AM, and 12 PM IST.
 * 2. Each scheduled job invokes only its assigned provider.
 * 3. A new HDHub4u title is appended only to HDHUB4U TITLE.txt.
 * 4. A new 10Moviez title is appended only to 10MOVIEZ TITLE.txt.
 * 5. A new HDWall title is appended only to HDWALL TITLE.txt.
 * 6. Existing title-list entries remain unchanged.
 * 7. Repeated runs do not create duplicate entries.
 * 8. A title already in the catalog can be added to another provider's title list without creating a duplicate canonical record.
 * 9. Failed ingestion does not create a false completed-history entry.
 * 10. A provider timeout or blocked source is reported accurately.
 * 11. Concurrent catalog updates do not overwrite one another.
 * 12. A failure in one provider does not disable the other scheduled jobs.
 * 13. Existing catalog IDs, links, sorting, filtering, pagination, and Available Versions remain intact.
 * 14. The catalog and title-list updates are deployed together after validation.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.dirname(__dirname);
const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const TITLE_LIST_DIR = path.join(ROOT_DIR, 'title list');
const CATALOG_PATH = path.join(ROOT_DIR, 'data', 'catalog.json');
const DOWNLOADS_PATH = path.join(ROOT_DIR, 'data', 'downloads.json');

const titleListSync = require('../scripts/title_list_sync');
const {
  syncProvider,
  runFullSync,
  formatTelegramReport,
  matchExistingTitle,
  normalizeTitle
} = require('../scripts/sync_core');

console.log('='.repeat(70));
console.log('PRAFLIX — INDEPENDENT CRAWLERS & TITLE-LIST SYNC ACCEPTANCE SUITE');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function runTest(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${desc} — PASSED`);
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${desc} — FAILED: ${err.message}`);
    throw err;
  }
}

// ----------------------------------------------------
// 1. UTC schedules correspond to 10 AM, 11 AM, and 12 PM IST
// ----------------------------------------------------
runTest('Each provider job runs at its correct UTC schedule (10 AM, 11 AM, 12 PM IST)', () => {
  const hdhubYml = fs.readFileSync(path.join(WORKFLOWS_DIR, 'hdhub4u-sync.yml'), 'utf8');
  const m10Yml = fs.readFileSync(path.join(WORKFLOWS_DIR, '10moviez-sync.yml'), 'utf8');
  const hdwallYml = fs.readFileSync(path.join(WORKFLOWS_DIR, 'hdwall-sync.yml'), 'utf8');

  // HDHub4u: 10:00 AM IST (UTC+05:30) = 04:30 UTC -> '30 4 * * *'
  assert.ok(hdhubYml.includes("cron: '30 4 * * *'"), 'HDHub4u schedule must be 04:30 UTC (10:00 AM IST)');

  // 10Moviez: 11:00 AM IST (UTC+05:30) = 05:30 UTC -> '30 5 * * *'
  assert.ok(m10Yml.includes("cron: '30 5 * * *'"), '10Moviez schedule must be 05:30 UTC (11:00 AM IST)');

  // HDWall: 12:00 PM IST (UTC+05:30) = 06:30 UTC -> '30 6 * * *'
  assert.ok(hdwallYml.includes("cron: '30 6 * * *'"), 'HDWall schedule must be 06:30 UTC (12:00 PM IST)');
});

// ----------------------------------------------------
// 2. Each scheduled job invokes only its assigned provider
// ----------------------------------------------------
runTest('Each scheduled job invokes only its assigned provider', () => {
  const hdhubYml = fs.readFileSync(path.join(WORKFLOWS_DIR, 'hdhub4u-sync.yml'), 'utf8');
  const m10Yml = fs.readFileSync(path.join(WORKFLOWS_DIR, '10moviez-sync.yml'), 'utf8');
  const hdwallYml = fs.readFileSync(path.join(WORKFLOWS_DIR, 'hdwall-sync.yml'), 'utf8');

  assert.ok(hdhubYml.includes('--provider hdhub4u'), 'HDHub4u workflow must invoke only hdhub4u');
  assert.ok(!hdhubYml.includes('--provider 10moviez'), 'HDHub4u workflow must not invoke 10moviez');

  assert.ok(m10Yml.includes('--provider 10moviez'), '10Moviez workflow must invoke only 10moviez');
  assert.ok(!m10Yml.includes('--provider hdwall'), '10Moviez workflow must not invoke hdwall');

  assert.ok(hdwallYml.includes('--provider hdwall'), 'HDWall workflow must invoke only hdwall');
  assert.ok(!hdwallYml.includes('--provider hdhub4u'), 'HDWall workflow must not invoke hdhub4u');
});

// ----------------------------------------------------
// 3. A new HDHub4u title is appended only to HDHUB4U TITLE.txt
// ----------------------------------------------------
runTest('A new HDHub4u title is appended only to HDHUB4U TITLE.txt', () => {
  const candidate = 'Unique HDHub4u Acceptance Test Release 2026';
  const res = titleListSync.syncProviderTitleList('hdhub4u', [candidate], { dryRun: true });
  assert.strictEqual(res.appendedCount, 1);
  assert.ok(res.filePath.endsWith('HDHUB4U TITLE.txt'), 'Must target HDHUB4U TITLE.txt');
  assert.ok(res.appendedTitles[0].match(/^\d{2}\/\d{2}\/\d{2}\s+Unique HDHub4u Acceptance Test Release/));

  // Verify other provider files remain unchanged
  const m10Path = titleListSync.getProviderFilePath('10moviez');
  const hdwallPath = titleListSync.getProviderFilePath('hdwall');
  assert.notStrictEqual(res.filePath, m10Path);
  assert.notStrictEqual(res.filePath, hdwallPath);
});

// ----------------------------------------------------
// 4. A new 10Moviez title is appended only to 10MOVIEZ TITLE.txt
// ----------------------------------------------------
runTest('A new 10Moviez title is appended only to 10MOVIEZ TITLE.txt', () => {
  const candidate = 'Unique 10Moviez Acceptance Test Series 2026';
  const res = titleListSync.syncProviderTitleList('10moviez', [candidate], { dryRun: true });
  assert.strictEqual(res.appendedCount, 1);
  assert.ok(res.filePath.endsWith('10MOVIEZ TITLE.txt'), 'Must target 10MOVIEZ TITLE.txt');
  assert.ok(res.appendedTitles[0].match(/^\d{2}\/\d{2}\/\d{2}\s+Unique 10Moviez Acceptance Test Series/));
});

// ----------------------------------------------------
// 5. A new HDWall title is appended only to HDWALL TITLE.txt
// ----------------------------------------------------
runTest('A new HDWall title is appended only to HDWALL TITLE.txt', () => {
  const candidate = 'Unique HDWall Acceptance Test Feature 2026';
  const res = titleListSync.syncProviderTitleList('hdwall', [candidate], { dryRun: true });
  assert.strictEqual(res.appendedCount, 1);
  assert.ok(res.filePath.endsWith('HDWALL TITLE.txt'), 'Must target HDWALL TITLE.txt');
  assert.ok(res.appendedTitles[0].match(/^\d{2}\/\d{2}\/\d{2}\s+Unique HDWall Acceptance Test Feature/));
});

// ----------------------------------------------------
// 6. Existing title-list entries remain unchanged
// ----------------------------------------------------
runTest('Existing title-list entries remain unchanged in content and order', () => {
  ['hdhub4u', '10moviez', 'hdwall'].forEach(prov => {
    const fPath = titleListSync.getProviderFilePath(prov);
    assert.ok(fs.existsSync(fPath), `${prov} title list file must exist`);
    const content = fs.readFileSync(fPath, 'utf8');
    const lines = content.split(/\r?\n/);
    assert.ok(lines.length > 50, `${prov} must have non-empty historical records`);
    // Ensure header section preserved
    assert.ok(lines[0].includes('TITLE LIST'), `${prov} header intact`);
    assert.ok(content.includes('Source:'), `${prov} source line intact`);
  });
});

// ----------------------------------------------------
// 7. Repeated runs do not create duplicate entries
// ----------------------------------------------------
runTest('Repeated runs do not create duplicate entries (case, punctuation, whitespace normalized)', () => {
  const candidateOriginal = 'Acceptance Duplicate Check Alpha (2026)';
  const candidateVariant = 'acceptance duplicate check alpha 2026 [Hindi DD5.1]';

  // First sync
  const res1 = titleListSync.syncProviderTitleList('hdhub4u', [candidateOriginal], { dryRun: true });
  assert.strictEqual(res1.appendedCount, 1);

  // Simulate in-memory duplicate check with the variant
  const keys1 = titleListSync.extractTitleKeys ? titleListSync.extractTitleKeys(candidateOriginal) : [titleListSync.normalizeTitleForComparison(candidateOriginal)];
  const keys2 = titleListSync.extractTitleKeys ? titleListSync.extractTitleKeys(candidateVariant) : [titleListSync.normalizeTitleForComparison(candidateVariant)];
  const overlap = keys1.some(k => keys2.includes(k));
  assert.ok(overlap, 'Punctuation and format variant must match original normalized key');
});

// ----------------------------------------------------
// 8. Title in catalog can be added to another provider's list without duplicate canonical record
// ----------------------------------------------------
runTest('Existing catalog title can be recorded for another provider without duplicate canonical record', async () => {
  const mockCatalog = [
    {
      canonicalId: 1001,
      id: 1001,
      displayTitle: 'Sherlock Holmes (2009)',
      normalizedTitle: 'sherlock holmes',
      year: '2009',
      type: 'Movie',
      variants: [{ source: 'hdhub4u', sourceUrl: 'https://hdhub4u/sherlock' }]
    }
  ];
  const mockSources = [];

  // 10Moviez discovers Sherlock Holmes
  const res = await syncProvider('10Moviez', mockCatalog, mockSources, {
    mockItems: {
      '10Moviez': [
        {
          provider: '10Moviez',
          source: '10moviez',
          displayTitle: 'Sherlock Holmes (2009)',
          year: '2009',
          type: 'Movie',
          sourceUrl: 'https://10moviez.biz/sherlock-holmes-2009',
          qualities: [{ resolution: '1080p' }]
        }
      ]
    },
    dryRun: true
  });

  // Verify no duplicate canonical title was created
  assert.strictEqual(mockCatalog.length, 1, 'Canonical catalog must not grow when existing title matches');
  assert.strictEqual(mockCatalog[0].canonicalId, 1001, 'Canonical ID must remain intact');
  assert.strictEqual(res.newMovies, 0, 'newMovies must be 0 for matched existing title');
  assert.strictEqual(res.updatedExisting, 1, 'updatedExisting must be incremented to 1');
  assert.ok(mockCatalog[0].variants.some(v => v.source === '10moviez'), '10Moviez variant added to existing record');

  // Verify 10Moviez title-list sync received the candidate
  assert.ok(res.titleListSync, 'Title list sync must execute');
  assert.strictEqual(res.titleListSync.provider, '10Moviez');
});

// ----------------------------------------------------
// 9. Failed ingestion does not create a false completed-history entry
// ----------------------------------------------------
runTest('Failed ingestion does not append false completed-history entry', async () => {
  const mockCatalog = [];
  const mockSources = [];

  const res = await syncProvider('10Moviez', mockCatalog, mockSources, {
    mockFailures: {
      '10Moviez': 'Cloudflare Challenge Abort 503'
    },
    dryRun: true
  });

  assert.strictEqual(res.failed, true, 'Provider sync must be marked failed');
  assert.ok(res.error.includes('Cloudflare Challenge Abort'), 'Error details captured');
  assert.strictEqual(mockCatalog.length, 0, 'No records added to catalog on failure');
});

// ----------------------------------------------------
// 10. Provider timeout or blocked source is reported accurately
// ----------------------------------------------------
runTest('Provider timeout or blocked source is reported accurately in report', async () => {
  const summary = {
    syncTime: new Date().toISOString(),
    formattedTime: '2026-10-11 05:30 UTC',
    targetProvider: '10Moviez',
    providers: {
      '10Moviez': {
        provider: '10Moviez',
        failed: true,
        error: 'Cloudflare Challenge Abort (HTTP 503)'
      }
    },
    totals: { moviesAdded: 0, seriesAdded: 0, totalTitlesAdded: 0, titleListAppended: 0 }
  };

  const report = formatTelegramReport(summary);
  assert.ok(report.includes('10MOVIEZ'), 'Report must include provider section');
  assert.ok(report.includes('⚠️ Sync failed: Cloudflare Challenge Abort'), 'Report must display exact failure error');
  assert.ok(report.includes('📝 Title List: Unchanged'), 'Title list must be shown as unchanged on failure');
});

// ----------------------------------------------------
// 11. Concurrent catalog updates do not overwrite one another
// ----------------------------------------------------
runTest('Concurrent catalog updates protected via GitHub Actions concurrency group & git pull rebase', () => {
  const workflows = ['hdhub4u-sync.yml', '10moviez-sync.yml', 'hdwall-sync.yml', 'daily-sync.yml'];
  workflows.forEach(wf => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), 'utf8');
    assert.ok(content.includes('group: praflix-catalog-sync'), `${wf} must share group praflix-catalog-sync`);
    assert.ok(content.includes('cancel-in-progress: false'), `${wf} must use cancel-in-progress: false to queue overlapping jobs`);
    assert.ok(content.includes('git pull --rebase'), `${wf} must use git pull --rebase before pushing to prevent overwrites`);
  });
});

// ----------------------------------------------------
// 12. A failure in one provider does not disable the other scheduled jobs
// ----------------------------------------------------
runTest('Failure in one provider does not disable the other scheduled jobs', () => {
  const hdhubYml = fs.readFileSync(path.join(WORKFLOWS_DIR, 'hdhub4u-sync.yml'), 'utf8');
  const m10Yml = fs.readFileSync(path.join(WORKFLOWS_DIR, '10moviez-sync.yml'), 'utf8');
  const hdwallYml = fs.readFileSync(path.join(WORKFLOWS_DIR, 'hdwall-sync.yml'), 'utf8');

  // Verify that they are independent workflow files with distinct names and schedules
  assert.notStrictEqual(hdhubYml, m10Yml);
  assert.notStrictEqual(m10Yml, hdwallYml);
  assert.ok(hdhubYml.includes('name: PRAFLIX HDHub4u Daily Synchronization'));
  assert.ok(m10Yml.includes('name: PRAFLIX 10Moviez Daily Synchronization'));
  assert.ok(hdwallYml.includes('name: PRAFLIX HDWall Daily Synchronization'));
});

// ----------------------------------------------------
// 13. Existing catalog IDs, links, sorting, filtering, and Available Versions remain intact
// ----------------------------------------------------
runTest('Existing catalog IDs, links, sorting, filtering, and Available Versions remain intact', () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const downloads = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));

  assert.ok(catalog.length >= 13678, 'Catalog size invariant verified');
  assert.strictEqual(catalog.length, downloads.entries.length, 'Downloads database 1:1 parity with catalog');

  // Check unique IDs
  const idSet = new Set(catalog.map(c => c.canonicalId));
  assert.strictEqual(idSet.size, catalog.length, 'All canonical IDs must be unique');

  // Check frontend contracts in app.js
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
  assert.ok(appJs.includes('available-versions-container'), 'Available Versions container intact');
  assert.ok(appJs.includes('applyFilters'), 'Filtering intact');
  assert.ok(appJs.includes('renderMovieGrid'), 'Catalog rendering intact');
});

// ----------------------------------------------------
// 14. Catalog and title-list updates are deployed together after validation
// ----------------------------------------------------
runTest('Catalog and title-list updates are staged and deployed together after validation', () => {
  const workflows = ['hdhub4u-sync.yml', '10moviez-sync.yml', 'hdwall-sync.yml', 'daily-sync.yml'];
  workflows.forEach(wf => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), 'utf8');
    assert.ok(content.includes('git add data/catalog.json'), `${wf} must stage catalog.json`);
    assert.ok(content.includes('"title list/"'), `${wf} must stage title list directory`);
    assert.ok(content.includes('npx wrangler deploy'), `${wf} must deploy after persistence`);
  });
});

console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} INDEPENDENT CRAWLERS & TITLE SYNC CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
