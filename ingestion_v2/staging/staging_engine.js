/**
 * PRAFLIX Ingestion Pipeline V2 — Staging Engine
 * A PRAVERSE Company
 *
 * Capabilities:
 * - Generates staging catalog artifacts in local staging_v2/ directory.
 * - Uploads isolated test runs to Backblaze B2 bucket `praflix-testing` under prefix `ingestion-v2/`.
 * - Produces explicit run statuses: SUCCESS, PARTIAL, FAILED, INCONCLUSIVE, VALIDATION_FAILED.
 * - Emits review queue for ambiguous records.
 * - Invariant: NEVER writes to production data/catalog.json or production B2 bucket.
 */

const fs = require('fs');
const path = require('path');
const { B2TestingClient } = require('../storage/b2_test_client');

const BASE_DIR = path.resolve(__dirname, '../../');
const LOCAL_STAGING_DIR = path.join(BASE_DIR, 'staging_v2');

class StagingEngine {
  /**
   * @param {Object} [options]
   * @param {B2TestingClient} [options.b2Client]
   * @param {string} [options.localStagingDir]
   */
  constructor(options = {}) {
    this.b2Client = options.b2Client || null;
    this.localStagingDir = options.localStagingDir || LOCAL_STAGING_DIR;

    if (!fs.existsSync(this.localStagingDir)) {
      fs.mkdirSync(this.localStagingDir, { recursive: true });
    }
  }

  /**
   * Determines run status based on discovery and evaluation outcomes
   * @param {Object} summary
   * @returns {'SUCCESS'|'PARTIAL'|'FAILED'|'INCONCLUSIVE'|'VALIDATION_FAILED'}
   */
  determineRunStatus(summary) {
    if (summary.validationErrors && summary.validationErrors.length > 0) {
      return 'VALIDATION_FAILED';
    }
    if (summary.isBlocked || summary.isChallenge) {
      return 'INCONCLUSIVE';
    }
    if (summary.pagesDiscovered === 0 && summary.discoveryErrors && summary.discoveryErrors.length > 0) {
      return 'FAILED';
    }
    if (summary.failedPagesCount > 0 && summary.pagesDiscovered > 0) {
      return 'PARTIAL';
    }
    if (summary.pagesDiscovered > 0 || summary.candidatesCount > 0) {
      return 'SUCCESS';
    }
    return 'INCONCLUSIVE';
  }

  /**
   * Generates formatted Markdown report for staging run
   * @param {Object} runResult
   * @returns {string}
   */
  formatMarkdownReport(runResult) {
    const { runId, provider, timestampIst, status, evaluation, discovery } = runResult;
    return `# PRAFLIX Ingestion Pipeline V2 — Staging Run Report
**Run ID**: \`${runId}\`  
**Provider**: **${provider}**  
**Execution Time**: ${timestampIst}  
**Status**: **${status}**  
**Destination**: \`praflix-testing/ingestion-v2/\` (Production Untouched)

---

## 1. Discovery Performance
- **Methods Used**: ${discovery.methodsUsed.join(', ') || 'None'}
- **Pages / URLs Discovered**: ${discovery.pagesDiscovered}
- **Successfully Parsed**: ${discovery.successfullyParsed}
- **Failed / Blocked Pages**: ${discovery.failedPages.length}

---

## 2. Ingestion & Matching Summary
| Category | Count | Action Taken |
| :--- | :--- | :--- |
| **New Canonical Titles** | ${evaluation.newCanonicalTitles.length} | Prepared for staging catalog |
| **Existing Titles Updated** | ${evaluation.existingTitlesUpdated.length} | New variants / metadata mapped |
| **Duplicate Records Skipped** | ${evaluation.duplicateRecords.length} | Skipped (idempotent) |
| **Ambiguous Records Queued** | ${evaluation.ambiguousRecords.length} | Routed to \`review-queue.json\` |
| **Invalid Records Rejected** | ${evaluation.rejectedRecords.length} | Rejected |

---

## 3. New Canonical Titles Staged
${
  evaluation.newCanonicalTitles.length === 0
    ? '_No new canonical titles discovered in this run._'
    : evaluation.newCanonicalTitles
        .map(t => `- **[praflix-${t.canonicalId}]** ${t.displayTitle} (${t.year || 'N/A'}) [${t.type}] — Variant: \`${t.variants[0]?.source || 'unknown'}\``)
        .join('\n')
}

---

## 4. Review Queue (Ambiguous Matches)
${
  evaluation.ambiguousRecords.length === 0
    ? '_No ambiguous records requiring review._'
    : evaluation.ambiguousRecords
        .map(a => `- **${a.candidate.displayTitle}** (${a.candidate.year || 'N/A'}): ${a.reason}`)
        .join('\n')
}
`;
  }

  /**
   * Executes staging generation and persistence to local staging_v2/ and B2
   * @param {Object} stagingPayload
   * @returns {Promise<{ localFiles: string[], b2Files: string[], summary: Object }>}
   */
  async stageRun(stagingPayload) {
    const runId = stagingPayload.runId || `v2_run_${Date.now()}`;
    const provider = stagingPayload.provider || 'All';
    const evaluation = stagingPayload.evaluation || {
      newCanonicalTitles: [],
      existingTitlesUpdated: [],
      duplicateRecords: [],
      ambiguousRecords: [],
      rejectedRecords: []
    };
    const discovery = stagingPayload.discovery || {
      methodsUsed: [],
      pagesDiscovered: 0,
      successfullyParsed: 0,
      failedPages: []
    };

    // Calculate IST time
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const timestampIst = istDate.toISOString().replace('T', ' ').slice(0, 19) + ' IST';

    const status = this.determineRunStatus({
      ...stagingPayload,
      pagesDiscovered: discovery.pagesDiscovered,
      candidatesCount: evaluation.newCanonicalTitles.length + evaluation.existingTitlesUpdated.length + evaluation.duplicateRecords.length
    });

    const runResult = {
      runId,
      provider,
      timestampIst,
      timestampUtc: now.toISOString(),
      status,
      discovery,
      evaluation
    };

    const mdReport = this.formatMarkdownReport(runResult);

    // 1. Write local staging files
    const localFiles = [];
    const localReportJson = path.join(this.localStagingDir, `${runId}_report.json`);
    const localReportMd = path.join(this.localStagingDir, `${runId}_report.md`);
    const localReviewQueue = path.join(this.localStagingDir, `${runId}_review_queue.json`);
    const localStagedCatalog = path.join(this.localStagingDir, `${runId}_staged_titles.json`);

    fs.writeFileSync(localReportJson, JSON.stringify(runResult, null, 2), 'utf8');
    fs.writeFileSync(localReportMd, mdReport, 'utf8');
    fs.writeFileSync(localReviewQueue, JSON.stringify(evaluation.ambiguousRecords, null, 2), 'utf8');
    fs.writeFileSync(localStagedCatalog, JSON.stringify(evaluation.newCanonicalTitles, null, 2), 'utf8');

    localFiles.push(localReportJson, localReportMd, localReviewQueue, localStagedCatalog);

    // 2. Upload to Backblaze B2 praflix-testing/ingestion-v2/ if client is present
    const b2Files = [];
    if (this.b2Client) {
      try {
        const reportUpload = await this.b2Client.uploadJson(`ingestion-v2/reports/${runId}_report.json`, runResult);
        const mdUpload = await this.b2Client.uploadJson(`ingestion-v2/reports/${runId}_report.md`, mdReport);
        const catalogUpload = await this.b2Client.uploadJson(`ingestion-v2/staging-catalog/${runId}_staged_titles.json`, evaluation.newCanonicalTitles);

        b2Files.push(reportUpload.fileName, mdUpload.fileName, catalogUpload.fileName);
      } catch (err) {
        console.warn(`[StagingEngine Warning] B2 upload skipped or failed: ${err.message}`);
      }
    }

    return {
      runId,
      status,
      timestampIst,
      localFiles,
      b2Files,
      summary: {
        provider,
        status,
        newTitlesCount: evaluation.newCanonicalTitles.length,
        updatedTitlesCount: evaluation.existingTitlesUpdated.length,
        duplicateCount: evaluation.duplicateRecords.length,
        ambiguousCount: evaluation.ambiguousRecords.length,
        rejectedCount: evaluation.rejectedRecords.length,
        pagesDiscovered: discovery.pagesDiscovered
      }
    };
  }
}

module.exports = {
  StagingEngine,
  LOCAL_STAGING_DIR
};
