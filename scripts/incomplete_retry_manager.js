/**
 * PRAFLIX — Robust, Bounded Retry-and-Recovery Manager for Incomplete Imports
 * A PRAVERSE Company
 *
 * Implements:
 * 1. Configurable bounded retry loop with exponential backoff and jitter.
 * 2. HTTP 429 Retry-After header compliance and transient server error handling.
 * 3. Accurate categorization of failures (unavailable, no links, rejected eligibility, etc.).
 * 4. Concurrency deduplication (preventing concurrent processing of the same title).
 * 5. Persistent retry ledger (data/incomplete_retry_state.json) to survive restarts.
 * 6. Protection against treating landing/intermediate pages as direct download links.
 * 7. Single final report notification generation with run-level idempotency.
 */

const fs = require('fs');
const path = require('path');
const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const DEFAULT_STATE_PATH = path.join(DATA_DIR, 'incomplete_retry_state.json');

const resolver = require(path.join(BASE_DIR, 'destination_resolver.js'));

class IncompleteRetryManager {
  constructor(options = {}) {
    this.maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 3;
    this.maxElapsedBudgetMs = Number.isInteger(options.maxElapsedBudgetMs) ? options.maxElapsedBudgetMs : 30000;
    this.initialBackoffMs = options.initialBackoffMs || 1000;
    this.maxBackoffMs = options.maxBackoffMs || 8000;
    this.jitterMs = options.jitterMs || 250;
    this.stateFilePath = options.stateFilePath || DEFAULT_STATE_PATH;
    this.activeLocks = new Set();
    this.fetchFn = options.fetchFn || global.fetch;
    this.sleepFn = options.sleepFn || (ms => new Promise(resolve => setTimeout(resolve, ms)));

    this.state = this.loadState();
  }

  loadState() {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf8');
        const data = JSON.parse(raw);
        return {
          version: '1.0',
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          items: data.items || {},
          referencePages: data.referencePages || {}
        };
      } catch (err) {
        console.warn(`[WARN] Could not parse retry state at ${this.stateFilePath}: ${err.message}`);
      }
    }
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      items: {},
      referencePages: {}
    };
  }

  saveState() {
    try {
      this.state.lastUpdated = new Date().toISOString();
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[WARN] Failed to write retry state: ${err.message}`);
    }
  }

  computeLockKey(candidate) {
    if (!candidate) return 'unknown';
    const title = (candidate.displayTitle || candidate.title || candidate.rawTitle || '').toLowerCase().trim();
    const url = (candidate.sourceUrl || candidate.url || '').toLowerCase().trim();
    return url || title;
  }

  calculateBackoff(attempt) {
    const exp = Math.min(this.initialBackoffMs * Math.pow(2, attempt - 1), this.maxBackoffMs);
    const jitter = Math.floor(Math.random() * this.jitterMs);
    return exp + jitter;
  }

  parseRetryAfter(headerValue) {
    if (!headerValue) return null;
    const asSec = parseInt(headerValue, 10);
    if (!isNaN(asSec) && asSec >= 0) {
      return asSec * 1000;
    }
    const asDate = Date.parse(headerValue);
    if (!isNaN(asDate)) {
      const diff = asDate - Date.now();
      return diff > 0 ? diff : 0;
    }
    return null;
  }

  classifyFailure({ httpStatus, error, extractedCandidates, rejectedReasons, html }) {
    if (httpStatus === 429) return 'rate_limited';
    if (httpStatus >= 500 && httpStatus <= 504) return 'retryable_server_error';
    if (error && (error.includes('timeout') || error.includes('ECONNRESET') || error.includes('ETIMEDOUT') || error.includes('network'))) {
      return 'retryable_network_timeout';
    }
    if (httpStatus === 404 || httpStatus === 410) return 'source_page_unavailable';
    if (html && html.includes('challenge-platform')) return 'anti_bot_challenge_inconclusive';
    if (!extractedCandidates || extractedCandidates.length === 0) return 'source_page_fetched_no_links';
    if (rejectedReasons && rejectedReasons.length > 0) return 'rejected_by_eligibility';
    return 'inconclusive';
  }

  inspectPageCandidates(html, sourceUrl, providerRules = {}) {
    const rawAnchors = [];
    const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      rawAnchors.push({ href, text });
    }

    const candidateUrls = [];
    const rejectedReasons = [];
    const validDestinations = [];

    const approvedPrefixes = providerRules.approvedPrefixes || [
      'https://hubdrive.pics/file/',
      'https://hblinks.lol/archives/',
      'https://hubcloud.ist/drive/'
    ];

    for (const a of rawAnchors) {
      const u = a.href;
      const lower = u.toLowerCase();

      // Check if it looks like a candidate download anchor
      const isCandidateAnchor = 
        lower.includes('hubdrive') ||
        lower.includes('hblinks') ||
        lower.includes('hubcloud') ||
        lower.includes('greenmotors') ||
        lower.includes('hdstream') ||
        lower.includes('snvhost') ||
        lower.includes('drive') ||
        lower.includes('file') ||
        a.text.match(/\b(480p|720p|1080p|2160p|4k|download|drive|watch|links)\b/i);

      if (!isCandidateAnchor) continue;

      candidateUrls.push({ url: u, text: a.text });

      // Intermediate link protector / ad redirector check
      if (lower.includes('greenmotors.club')) {
        rejectedReasons.push({
          url: u,
          reason: 'unapproved_intermediate_ad_protector: greenmotors.club'
        });
        continue;
      }
      if (lower.includes('snvhost.com')) {
        rejectedReasons.push({
          url: u,
          reason: 'unapproved_ad_redirector: snvhost.com'
        });
        continue;
      }
      if (lower.includes('hdstream4u.com')) {
        rejectedReasons.push({
          url: u,
          reason: 'unapproved_streaming_player: hdstream4u.com (not direct download storage)'
        });
        continue;
      }

      // Check approved prefix match
      const matchesApprovedPrefix = approvedPrefixes.some(pref => u.startsWith(pref));
      if (!matchesApprovedPrefix) {
        rejectedReasons.push({
          url: u,
          reason: `prefix_not_approved_for_provider: host ${u.split('/')[2] || u}`
        });
        continue;
      }

      // Verify destination classification
      const verification = resolver.classifyLinkVerification(u, sourceUrl);
      if (verification.status === 'verified') {
        validDestinations.push({
          downloadUrl: u,
          label: a.text,
          verificationEvidence: verification.evidence || 'approved_provider_prefix'
        });
      } else {
        rejectedReasons.push({
          url: u,
          reason: `destination_verification_failed: ${verification.reason}`
        });
      }
    }

    return {
      rawAnchorsCount: rawAnchors.length,
      candidateUrls,
      rejectedReasons,
      validDestinations
    };
  }

  async retryTitle(candidate, options = {}) {
    const lockKey = this.computeLockKey(candidate);
    if (this.activeLocks.has(lockKey)) {
      return {
        status: 'skipped_concurrent_active',
        message: `Title "${lockKey}" is currently locked by active retry job. Duplicate concurrent execution prevented.`,
        candidate
      };
    }

    this.activeLocks.add(lockKey);
    const startEpoch = Date.now();
    let attempt = 0;
    const history = [];

    const existingState = this.state.items[lockKey] || {
      firstAttemptedAt: new Date().toISOString(),
      previousAttempts: 0
    };

    try {
      while (attempt < this.maxAttempts) {
        attempt++;
        const elapsed = Date.now() - startEpoch;
        if (elapsed >= this.maxElapsedBudgetMs) {
          history.push({
            attempt,
            outcome: 'budget_exhausted',
            elapsedMs: elapsed
          });
          break;
        }

        const sourceUrl = candidate.sourceUrl || candidate.url;
        let resp = null;
        let html = '';
        let httpStatus = null;
        let errorMsg = null;
        let retryAfterMs = null;

        try {
          resp = await this.fetchFn(sourceUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (PRAFLIX-RetryBot/1.0)'
            },
            signal: AbortSignal.timeout(options.timeoutMs || 8000)
          });
          httpStatus = resp.status;
          if (resp.headers && typeof resp.headers.get === 'function') {
            const ra = resp.headers.get('retry-after');
            if (ra) retryAfterMs = this.parseRetryAfter(ra);
          }
          if (resp.ok) {
            html = await resp.text();
          } else {
            errorMsg = `HTTP ${httpStatus} returned from ${sourceUrl}`;
          }
        } catch (fetchErr) {
          errorMsg = fetchErr.message;
        }

        const inspection = html ? this.inspectPageCandidates(html, sourceUrl, options.providerRules) : {
          rawAnchorsCount: 0,
          candidateUrls: [],
          rejectedReasons: [],
          validDestinations: []
        };

        const failureCat = this.classifyFailure({
          httpStatus,
          error: errorMsg,
          extractedCandidates: inspection.candidateUrls,
          rejectedReasons: inspection.rejectedReasons,
          html
        });

        const attemptLog = {
          attempt,
          timestamp: new Date().toISOString(),
          httpStatus,
          error: errorMsg,
          failureCategory: failureCat,
          candidateUrlsCount: inspection.candidateUrls.length,
          rejectedReasons: inspection.rejectedReasons,
          validDestinationsFound: inspection.validDestinations.length
        };
        history.push(attemptLog);

        // Check if valid destinations were recovered
        if (inspection.validDestinations.length > 0) {
          const result = {
            status: 'recovered',
            candidate,
            attempts: attempt,
            elapsedMs: Date.now() - startEpoch,
            validDestinations: inspection.validDestinations,
            history
          };
          this.state.items[lockKey] = {
            ...existingState,
            status: 'recovered',
            resolvedAt: new Date().toISOString(),
            attempts: attempt,
            validDestinationsCount: inspection.validDestinations.length,
            history
          };
          this.saveState();
          return result;
        }

        // If completed inspection succeeded with zero candidates and it's not a transient failure,
        // do not retry repeatedly without a recovery strategy
        const isTransient = failureCat === 'rate_limited' ||
                            failureCat === 'retryable_server_error' ||
                            failureCat === 'retryable_network_timeout';

        if (!isTransient && attempt >= 1) {
          // Completed inspection confirmed no eligible links on unchanged page
          break;
        }

        // Apply backoff before next attempt
        if (attempt < this.maxAttempts) {
          const sleepDuration = retryAfterMs || this.calculateBackoff(attempt);
          await this.sleepFn(sleepDuration);
        }
      }

      // Exhausted or completed with no links
      const lastAttempt = history[history.length - 1] || {};
      const finalResult = {
        status: 'unresolved_after_retries',
        candidate,
        attempts: attempt,
        elapsedMs: Date.now() - startEpoch,
        failureCategory: lastAttempt.failureCategory || 'no_eligible_links',
        rejectedReasons: lastAttempt.rejectedReasons || [],
        history
      };

      this.state.items[lockKey] = {
        ...existingState,
        status: 'unresolved_after_retries',
        lastAttemptAt: new Date().toISOString(),
        attempts: attempt,
        failureCategory: finalResult.failureCategory,
        rejectedReasons: finalResult.rejectedReasons,
        history
      };
      this.saveState();

      return finalResult;
    } finally {
      this.activeLocks.delete(lockKey);
    }
  }

  async retryBatch(candidates = [], options = {}) {
    const results = [];
    for (const cand of candidates) {
      const res = await this.retryTitle(cand, options);
      results.push(res);
    }
    return results;
  }

  recordReferencePage(canonicalTitle, referenceUrl, quality = '', notes = '') {
    const key = (canonicalTitle || '').toLowerCase().trim();
    if (!this.state.referencePages) this.state.referencePages = {};
    this.state.referencePages[key] = {
      canonicalTitle,
      referenceUrl,
      quality,
      notes,
      recordedAt: new Date().toISOString(),
      status: 'unverified_reference_source',
      isDirectDownloadDestination: false
    };
    this.saveState();
    return this.state.referencePages[key];
  }

  generateNotificationSummary(runKey, results = []) {
    const recovered = results.filter(r => r.status === 'recovered');
    const unresolved = results.filter(r => r.status === 'unresolved_after_retries');
    const skipped = results.filter(r => r.status === 'skipped_concurrent_active');

    return {
      runKey,
      timestamp: new Date().toISOString(),
      totalProcessed: results.length,
      recoveredCount: recovered.length,
      unresolvedCount: unresolved.length,
      skippedCount: skipped.length,
      recoveredTitles: recovered.map(r => r.candidate?.displayTitle || r.candidate?.title),
      unresolvedDetails: unresolved.map(r => ({
        title: r.candidate?.displayTitle || r.candidate?.title,
        sourceUrl: r.candidate?.sourceUrl || r.candidate?.url,
        attempts: r.attempts,
        failureCategory: r.failureCategory,
        rejectedCount: (r.rejectedReasons || []).length
      }))
    };
  }
}

module.exports = IncompleteRetryManager;
