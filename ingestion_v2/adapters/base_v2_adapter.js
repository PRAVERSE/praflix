/**
 * PRAFLIX Ingestion Pipeline V2 — Base Provider Adapter
 * A PRAVERSE Company
 *
 * Defines the unified contract and common utilities for V2 provider adapters.
 * Reuses existing proven modules safely:
 * - scripts/title_decoder.js
 * - destination_resolver.js
 */

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '../../');
const titleDecoder = require(path.join(BASE_DIR, 'scripts/title_decoder'));
const resolver = require(path.join(BASE_DIR, 'destination_resolver'));

class BaseV2Adapter {
  constructor(providerConfig = {}) {
    this.config = providerConfig;
    this.id = providerConfig.id || 'provider';
    this.displayName = providerConfig.displayName || this.id;
  }

  cleanTitle(rawTitle) {
    return titleDecoder.cleanTitle(rawTitle);
  }

  extractTitleMetadata(rawTitle) {
    return titleDecoder.extractTitleMetadata(rawTitle);
  }

  detectContentType(title, category = '', url = '') {
    const t = (title || '').toLowerCase();
    const c = (category || '').toLowerCase();
    const u = (url || '').toLowerCase();

    if (
      t.includes('season') ||
      t.includes('series') ||
      t.includes('episode') ||
      t.includes('s01') ||
      t.includes('s02') ||
      t.includes('s03') ||
      c.includes('web series') ||
      c.includes('tv series') ||
      c.includes('series') ||
      u.includes('season-') ||
      u.includes('all-episodes') ||
      u.includes('full-series') ||
      u.includes('web-series')
    ) {
      return 'Web Series';
    }
    return 'Movie';
  }

  /**
   * Extracts explicit resolution token from a text string.
   * Returns: '4K', '1080p', '720p', '480p', '360p', or null if unspecified / generic.
   * Avoids false positives on words like "HDHub4u", "HDRip", "HQ", "Full Movie".
   */
  extractExplicitResolution(text) {
    if (!text || typeof text !== 'string') return null;
    const s = text.toLowerCase().trim();

    // 1. 4K / 2160p / UHD
    if (/\b(?:4k|2160p?|uhd)\b/i.test(s) || /2160\s*p/i.test(s)) {
      return '4K';
    }

    // 2. 1080p / FHD / Full HD
    if (/\b(?:1080p?|fhd)\b/i.test(s) || /full[\s_-]?hd\b/i.test(s) || /1080\s*p/i.test(s)) {
      return '1080p';
    }

    // 3. 720p / HD (ensure "HD" is standalone and not part of "Full HD", "HDHub4u", "HDWall", "HDRip", "HDTC", etc.)
    if (/\b(?:720p?)\b/i.test(s) || /720\s*p/i.test(s)) {
      return '720p';
    }
    if (/\bhd\b/i.test(s) && !/full[\s_-]?hd/i.test(s) && !/hdhub/i.test(s) && !/hdwall/i.test(s) && !/hdrip/i.test(s) && !/hdtc/i.test(s)) {
      return '720p';
    }

    // 4. 480p / SD
    if (/\b(?:480p?|sd)\b/i.test(s) || /480\s*p/i.test(s)) {
      return '480p';
    }

    // 5. 360p
    if (/\b(?:360p?)\b/i.test(s) || /360\s*p/i.test(s)) {
      return '360p';
    }

    return null;
  }

  /**
   * Extracts unambiguous single resolution from surrounding context (e.g. post heading).
   * If multiple distinct resolutions are mentioned, returns null to avoid misattributing.
   */
  extractContextResolution(context) {
    if (!context || typeof context !== 'string') return null;
    const resolutions = new Set();
    const s = context.toLowerCase();
    if (/\b(?:4k|2160p?|uhd)\b/i.test(s)) resolutions.add('4K');
    if (/\b(?:1080p?|fhd|full[\s_-]?hd)\b/i.test(s)) resolutions.add('1080p');
    if (/\b(?:720p?)\b/i.test(s)) resolutions.add('720p');
    if (/\b(?:480p?|sd)\b/i.test(s)) resolutions.add('480p');
    if (/\b(?:360p?)\b/i.test(s)) resolutions.add('360p');

    if (resolutions.size === 1) {
      return Array.from(resolutions)[0];
    }
    return null;
  }

  /**
   * Resolves quality resolution with source attribution, conflict detection, and file metadata support.
   */
  resolveQualityDetailed({ rawLabel = '', fallbackContext = '', fileMetadata = null, probeFailed = false, candidate = null } = {}) {
    const originalLabel = typeof rawLabel === 'string' ? rawLabel.trim() : '';

    // 1. Check explicit resolution in source link label
    const labelRes = this.extractExplicitResolution(originalLabel);

    // 2. Check candidate structured metadata (e.g. candidate.resolution, candidate.quality)
    let candidateRes = null;
    if (candidate && typeof candidate === 'object') {
      const explicitCand = candidate.resolution || candidate.quality;
      if (explicitCand && typeof explicitCand === 'string' && explicitCand.toLowerCase() !== 'unknown' && explicitCand.toLowerCase() !== '720p') {
        candidateRes = this.extractExplicitResolution(explicitCand);
      }
    }

    // 3. Check file metadata (handling timeout, redirect, malformed, and failed probes)
    let fileRes = null;
    let fileSourceType = 'file_metadata';
    const isProbeFailed = probeFailed || (fileMetadata && (
      fileMetadata.status === 'failed' ||
      fileMetadata.status === 'timeout' ||
      fileMetadata.status === 'redirect_blocked' ||
      fileMetadata.status === 'malformed_response' ||
      fileMetadata.error
    ));

    if (fileMetadata && !isProbeFailed) {
      // First priority: physical video stream height / container metadata
      if (typeof fileMetadata.height === 'number') {
        if (fileMetadata.height >= 2160) fileRes = '4K';
        else if (fileMetadata.height >= 1080) fileRes = '1080p';
        else if (fileMetadata.height >= 720) fileRes = '720p';
        else if (fileMetadata.height >= 480) fileRes = '480p';
        else if (fileMetadata.height >= 360) fileRes = '360p';
        fileSourceType = 'file_metadata';
      } else if (fileMetadata.resolution && (fileMetadata.videoStream || fileMetadata.probeType === 'stream')) {
        fileRes = this.extractExplicitResolution(fileMetadata.resolution);
        fileSourceType = 'file_metadata';
      }

      // Second priority: filename on storage server / CDN
      if (!fileRes) {
        const metaFilename = fileMetadata.filename || fileMetadata.name || '';
        const metaTitle = fileMetadata.title || '';
        if (metaFilename) {
          fileRes = this.extractExplicitResolution(metaFilename);
          if (fileRes) fileSourceType = 'filename_metadata';
        }
        if (!fileRes && metaTitle) {
          fileRes = this.extractExplicitResolution(metaTitle);
          if (fileRes) fileSourceType = 'filename_metadata';
        }
        if (!fileRes && typeof fileMetadata.resolution === 'string') {
          fileRes = this.extractExplicitResolution(fileMetadata.resolution);
          if (fileRes) fileSourceType = 'file_metadata';
        }
      }
    }

    // 4. Determine resolution and check for conflicts
    let finalResolution = 'unknown';
    let source = 'unknown';
    let hasConflict = false;

    if (fileRes && labelRes) {
      if (fileRes !== labelRes) {
        hasConflict = true;
        // Authoritative file probe represents the actual binary payload file
        finalResolution = fileRes;
        source = fileSourceType === 'filename_metadata'
          ? 'filename_metadata_override_conflict'
          : 'file_metadata_override_conflict';
      } else {
        finalResolution = fileRes;
        source = fileSourceType === 'filename_metadata'
          ? 'filename_metadata_confirmed'
          : 'file_metadata_confirmed';
      }
    } else if (fileRes && !labelRes) {
      // Generic or missing label, but file metadata probe provided resolution
      finalResolution = fileRes;
      source = fileSourceType;
    } else if (labelRes) {
      // Explicit source label (and no contradictory file metadata or probe missing/failed)
      finalResolution = labelRes;
      source = 'explicit_source_label';
    } else if (candidateRes) {
      finalResolution = candidateRes;
      source = 'structured_metadata';
    } else {
      // Try unambiguous context from page heading
      const ctxRes = this.extractContextResolution(fallbackContext);
      if (ctxRes) {
        finalResolution = ctxRes;
        source = 'unambiguous_context';
      } else {
        // Unknown or pending verification - NEVER fabricate 720p!
        finalResolution = 'unknown';
        source = 'unknown';
      }
    }

    return {
      resolution: finalResolution,
      sourceLabel: originalLabel,
      hasConflict,
      source,
      resolutionSource: source,
      fileResolution: fileRes,
      labelResolution: labelRes
    };
  }

  /**
   * Normalizes raw quality text into a canonical resolution string:
   * '4K', '1080p', '720p', '480p', '360p', or 'unknown'.
   * Never fabricates '720p' when resolution is unspecified or generic.
   */
  normalizeQuality(raw, fallbackContext = '', options = {}) {
    let rawLabel = '';
    if (typeof raw === 'string') {
      rawLabel = raw;
    } else if (raw && typeof raw === 'object') {
      rawLabel = raw.rawQuality || raw.quality || raw.label || raw.text || '';
    }

    let fbContext = '';
    if (typeof fallbackContext === 'string') {
      fbContext = fallbackContext;
    } else if (fallbackContext && typeof fallbackContext === 'object') {
      options = fallbackContext;
    }

    const fileMetadata = options.fileMetadata || (raw && typeof raw === 'object' ? raw.fileMetadata : null) || null;
    const probeFailed = options.probeFailed || (raw && typeof raw === 'object' ? raw.probeFailed : false) || false;
    const candidate = options.candidate || (raw && typeof raw === 'object' ? raw : null);

    const detailed = this.resolveQualityDetailed({
      rawLabel,
      fallbackContext: fbContext,
      fileMetadata,
      probeFailed,
      candidate
    });

    return detailed.resolution;
  }

  /**
   * Validates a candidate link against destination_resolver and provider eligibility rules
   * @param {Object|string} candidate
   * @param {string} sourceUrl
   * @param {Object} [options]
   * @returns {{ isValid: boolean, status: string, resolution?: string, reason?: string, evidence?: string }}
   */
  validateLink(candidate, sourceUrl, options = {}) {
    const rawUrl = typeof candidate === 'string'
      ? candidate
      : (candidate.downloadUrl || candidate.url || candidate.link || '');

    if (!rawUrl || typeof rawUrl !== 'string') {
      return { isValid: false, status: 'rejected', reason: 'empty_url' };
    }

    const trimmedUrl = rawUrl.trim();

    // Provider specific prefix rules (e.g. HDHub4u approved prefixes restriction)
    const approvedPrefixes = this.config.eligibilityRules && (this.config.eligibilityRules.approvedPrefixes || this.config.eligibilityRules.eligibleUrlPrefixes);
    if (Array.isArray(approvedPrefixes) && approvedPrefixes.length > 0) {
      const matchesAny = approvedPrefixes.some(prefix => trimmedUrl.startsWith(prefix));
      if (!matchesAny) {
        return { isValid: false, status: 'rejected', reason: 'rejected_prefix_violation' };
      }
    } else if (this.config.eligibilityRules && this.config.eligibilityRules.requireExactHubDrivePrefix) {
      const requiredPrefix = this.config.eligibilityRules.requiredHubDrivePrefix || 'https://hubdrive.pics/file/';
      if (!trimmedUrl.startsWith(requiredPrefix)) {
        return { isValid: false, status: 'rejected', reason: 'rejected_hubdrive_prefix_violation' };
      }
    }

    // Series complete-season policy: filter out loose individual episodes
    const isSeries = typeof candidate === 'object' && (candidate.isSeries || candidate.type === 'Web Series');
    if (isSeries && typeof candidate === 'object') {
      const epDesc = candidate.episode || candidate.rawLabel || candidate.label || '';
      if (epDesc && !resolver.isCompleteSeason(candidate)) {
        return { isValid: false, status: 'rejected', reason: 'rejected_incomplete_season_episode' };
      }
    }

    const classification = resolver.classifyLinkVerification(candidate, sourceUrl);
    if (classification.status !== 'verified') {
      return { isValid: false, status: classification.status, reason: classification.reason || 'unverified_destination' };
    }

    const rawLabel = typeof candidate === 'string'
      ? ''
      : (candidate.rawQuality || candidate.text || candidate.label || candidate.rawLabel || '');

    const fallbackCtx = (typeof candidate === 'object')
      ? (candidate.titleContext || candidate.originalTitle || candidate.rawHeading || '')
      : '';

    const fileMeta = (typeof candidate === 'object')
      ? (candidate.fileMetadata || candidate.probe || options.fileMetadata || null)
      : (options.fileMetadata || null);

    const probeFailed = (typeof candidate === 'object')
      ? (candidate.probeFailed || options.probeFailed || false)
      : (options.probeFailed || false);

    const detailed = this.resolveQualityDetailed({
      rawLabel,
      fallbackContext: fallbackCtx,
      fileMetadata: fileMeta,
      probeFailed,
      candidate: typeof candidate === 'object' ? candidate : null
    });

    return {
      isValid: true,
      status: 'verified',
      resolution: detailed.resolution,
      quality: detailed.resolution,
      rawQuality: rawLabel || detailed.resolution,
      sourceLabel: rawLabel,
      hasQualityConflict: detailed.hasConflict,
      resolutionSource: detailed.source,
      evidence: classification.evidence || 'destination_resolved'
    };
  }

  /**
   * Must be implemented by subclasses
   */
  async discover(options = {}) {
    throw new Error(`[Adapter Error] discover() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Must be implemented by subclasses
   */
  parseDetailPage(html, pageUrl = '') {
    throw new Error(`[Adapter Error] parseDetailPage() must be implemented by ${this.constructor.name}`);
  }
}

module.exports = {
  BaseV2Adapter
};
