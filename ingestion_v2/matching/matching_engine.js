/**
 * PRAFLIX Ingestion Pipeline V2 — Hierarchical Matching & Deduplication Engine
 * A PRAVERSE Company
 *
 * Matching Hierarchy:
 * 1. Existing Stable Canonical ID.
 * 2. Exact Normalized Source URL in Variants.
 * 3. Normalized Title + Year + Content Type.
 * 4. Season & Episode Partitioning for Web Series.
 *
 * Ambiguity & Safety Invariants:
 * - Movies vs Web Series NEVER merge.
 * - Similar titles with different release years (e.g. 2025 vs 2026) NEVER merge.
 * - Conflicting or uncertain matches are routed to the review queue instead of modifying catalog.
 * - Idempotent: repeated runs never duplicate canonical IDs or provider variants.
 */

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '../../');
const titleDecoder = require(path.join(BASE_DIR, 'scripts/title_decoder'));

class MatchingEngine {
  /**
   * @param {Array<Object>} existingCatalog - Master catalog array
   */
  constructor(existingCatalog = []) {
    this.catalog = existingCatalog;
    this.rebuildIndexes();
  }

  /**
   * Builds O(1) in-memory lookup indexes
   */
  rebuildIndexes() {
    this.urlIndex = new Map();
    this.titleYearTypeIndex = new Map();
    this.canonicalIdIndex = new Map();

    let maxId = 0;
    for (const item of this.catalog) {
      if (item.canonicalId && typeof item.canonicalId === 'number') {
        if (item.canonicalId > maxId) maxId = item.canonicalId;
        this.canonicalIdIndex.set(item.canonicalId, item);
      }

      // Index variants by sourceUrl
      if (Array.isArray(item.variants)) {
        for (const v of item.variants) {
          if (v.sourceUrl) {
            this.urlIndex.set(v.sourceUrl.toLowerCase().trim(), item);
          }
        }
      }

      // Index by normalizedTitle + year + type + season
      const normTitle = titleDecoder.normalizeForMatching(item.displayTitle || '', '');
      const year = (item.year || '').trim();
      const type = (item.type || 'Movie').trim();
      const season = (item.season || '').trim().toLowerCase();
      const key = `${normTitle}__${year}__${type}__${season}`;
      this.titleYearTypeIndex.set(key, item);
    }

    this.nextCanonicalId = maxId + 1;
  }

  /**
   * Matches a normalized candidate item against the existing catalog
   * @param {Object} candidate
   * @returns {{ match: Object|null, matchType: string, isAmbiguous: boolean, reason?: string }}
   */
  findMatch(candidate) {
    if (!candidate || !candidate.displayTitle) {
      return { match: null, matchType: 'none', isAmbiguous: false, reason: 'invalid_candidate' };
    }

    // 1. Direct Canonical ID match
    if (candidate.canonicalId && this.canonicalIdIndex.has(candidate.canonicalId)) {
      return { match: this.canonicalIdIndex.get(candidate.canonicalId), matchType: 'canonical_id', isAmbiguous: false };
    }

    // 2. Exact Source URL match
    const candUrl = (candidate.variants && candidate.variants[0] && candidate.variants[0].sourceUrl || candidate.sourceUrl || '').toLowerCase().trim();
    if (candUrl && this.urlIndex.has(candUrl)) {
      return { match: this.urlIndex.get(candUrl), matchType: 'source_url', isAmbiguous: false };
    }

    // 3. Exact Normalized Title + Year + Type + Season match
    const candNorm = titleDecoder.normalizeForMatching(candidate.displayTitle, '');
    const candYear = (candidate.year || '').trim();
    const candType = (candidate.type || 'Movie').trim();
    const candSeason = (candidate.season || '').trim().toLowerCase();

    const exactKey = `${candNorm}__${candYear}__${candType}__${candSeason}`;
    if (this.titleYearTypeIndex.has(exactKey)) {
      return { match: this.titleYearTypeIndex.get(exactKey), matchType: 'title_year_type_season', isAmbiguous: false };
    }

    // 4. Ambiguity Check: Title matches, but Year or Type differs
    for (const item of this.catalog) {
      const itemNorm = titleDecoder.normalizeForMatching(item.displayTitle, '');
      if (itemNorm === candNorm) {
        // Content type conflict (Movie vs Web Series) -> Distinct titles!
        if (item.type && candType && item.type !== candType) {
          continue; // Not a match, allow separate canonical entry
        }

        // Season conflict for Web Series -> Distinct titles!
        if (candType === 'Web Series') {
          const itemSeason = (item.season || '').trim().toLowerCase();
          if (candSeason && itemSeason && candSeason !== itemSeason) {
            continue; // Season 1 vs Season 2 are separate canonical items
          }
        }

        // Release year check
        const itemYear = (item.year || '').trim();
        if (candYear && itemYear) {
          const candYNum = parseInt(candYear, 10);
          const itemYNum = parseInt(itemYear, 10);
          if (!isNaN(candYNum) && !isNaN(itemYNum)) {
            if (candYNum === itemYNum) {
              return { match: item, matchType: 'title_year_loose', isAmbiguous: false };
            }
            if (Math.abs(candYNum - itemYNum) > 1) {
              // Significant year gap: e.g. "Weapons" 2025 vs 2026 -> Ambiguous or distinct!
              return { match: null, matchType: 'ambiguous_year_gap', isAmbiguous: true, reason: `Year discrepancy between ${candYear} and ${itemYear}` };
            }
          }
        }
      }
    }

    return { match: null, matchType: 'none', isAmbiguous: false };
  }

  /**
   * Processes a batch of normalized records and categorizes them into proposed staging actions
   * @param {Array<Object>} candidates
   * @returns {{
   *   newCanonicalTitles: Array<Object>,
   *   existingTitlesUpdated: Array<Object>,
   *   duplicateRecords: Array<Object>,
   *   ambiguousRecords: Array<Object>,
   *   rejectedRecords: Array<Object>
   * }}
   */
  evaluateBatch(candidates) {
    const newCanonicalTitles = [];
    const existingTitlesUpdated = [];
    const duplicateRecords = [];
    const ambiguousRecords = [];
    const rejectedRecords = [];

    const stagedTitleKeys = new Set();

    for (const cand of candidates) {
      if (!cand || !cand.displayTitle) {
        rejectedRecords.push({ record: cand, reason: 'missing_display_title' });
        continue;
      }

      const matchRes = this.findMatch(cand);

      if (matchRes.isAmbiguous) {
        ambiguousRecords.push({
          candidate: cand,
          reason: matchRes.reason || 'ambiguous_match'
        });
        continue;
      }

      if (matchRes.match) {
        const existing = matchRes.match;
        const newVariant = cand.variants && cand.variants[0];

        // Check if variant is already present
        const alreadyHasVariant = newVariant && (existing.variants || []).some(
          v => v.source === newVariant.source && (v.sourceUrl === newVariant.sourceUrl || v.sourceId === newVariant.sourceId)
        );

        if (alreadyHasVariant) {
          duplicateRecords.push({
            candidate: cand,
            matchedCanonicalId: existing.canonicalId,
            reason: 'exact_variant_already_present'
          });
        } else {
          existingTitlesUpdated.push({
            canonicalId: existing.canonicalId,
            displayTitle: existing.displayTitle,
            existingRecord: existing,
            incomingRecord: cand,
            action: 'attach_variant_and_metadata'
          });
        }
      } else {
        // Genuinely new canonical title!
        const candNorm = titleDecoder.normalizeForMatching(cand.displayTitle, '');
        const candYear = (cand.year || '').trim();
        const candType = (cand.type || 'Movie').trim();
        const candSeason = (cand.season || '').trim().toLowerCase();
        const stageKey = `${candNorm}__${candYear}__${candType}__${candSeason}`;

        if (stagedTitleKeys.has(stageKey)) {
          duplicateRecords.push({
            candidate: cand,
            reason: 'duplicate_within_current_batch'
          });
        } else {
          stagedTitleKeys.add(stageKey);
          const assignedId = this.nextCanonicalId++;
          newCanonicalTitles.push({
            ...cand,
            id: `praflix-${assignedId}`,
            canonicalId: assignedId
          });
        }
      }
    }

    return {
      newCanonicalTitles,
      existingTitlesUpdated,
      duplicateRecords,
      ambiguousRecords,
      rejectedRecords
    };
  }
}

module.exports = {
  MatchingEngine
};
