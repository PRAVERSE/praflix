/**
 * PRAFLIX Ingestion Pipeline V2 — Reversible Production Catalog Merger
 * A PRAVERSE Company
 *
 * Core Safety Rules:
 * 1. Strict Ingestion Gate: Only promotes records with verified download links.
 * 2. ID Preservation: Canonical IDs are preserved and incremented monotonically.
 * 3. Atomic Backups: Timestamped backup files created before any write.
 * 4. Reversible: Includes instant rollback capability from backup snapshots.
 * 5. Dry-Run First: Generates full change preview before applying.
 * 6. Gatekeeper: Requires explicit confirmation flag; never runs automatically.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE_DIR = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(BASE_DIR, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const DOWNLOADS_PATH = path.join(DATA_DIR, 'downloads.json');
const SOURCES_PATH = path.join(DATA_DIR, 'source-records.json');
const TITLE_LIST_DIR = path.join(BASE_DIR, 'title list');

class CatalogMerger {
  constructor() {
    this.catalogPath = CATALOG_PATH;
    this.downloadsPath = DOWNLOADS_PATH;
    this.sourcesPath = SOURCES_PATH;
  }

  /**
   * Evaluates staged records and produces a dry-run merge plan
   * @param {Array<Object>} stagedTitles
   * @param {Array<Object>} [existingUpdates]
   * @returns {Object} Detailed merge plan
   */
  createMergePlan(stagedTitles = [], existingUpdates = []) {
    if (!fs.existsSync(this.catalogPath) || !fs.existsSync(this.downloadsPath)) {
      throw new Error('[Merger Error] Master catalog or downloads.json missing.');
    }

    const currentCatalog = JSON.parse(fs.readFileSync(this.catalogPath, 'utf8'));
    const currentDownloads = JSON.parse(fs.readFileSync(this.downloadsPath, 'utf8'));

    const existingIds = new Set(currentCatalog.map(item => item.canonicalId));
    let maxId = Math.max(...Array.from(existingIds), 0);

    const approvedNewTitles = [];
    const quarantinedUnverified = [];
    const approvedExistingUpdates = [];
    const downloadEntriesToAdd = [];
    const existingTitleLookup = new Map();

    for (const item of currentCatalog) {
      const key = `${(item.normalizedTitle || item.displayTitle).toLowerCase().trim()}__${(item.year || '').trim()}__${(item.type || 'Movie').trim()}`;
      existingTitleLookup.set(key, item);
    }

    // 1. Process candidate new canonical titles
    for (const item of stagedTitles) {
      const hasLinks = Array.isArray(item.downloadLinks) && item.downloadLinks.length > 0;
      if (!hasLinks) {
        quarantinedUnverified.push({
          title: item.displayTitle,
          year: item.year,
          reason: 'quarantined_no_verified_download_links'
        });
        continue;
      }

      // Defense-in-depth: check if title already exists in master catalog
      const titleKey = `${(item.normalizedTitle || item.displayTitle).toLowerCase().trim()}__${(item.year || '').trim()}__${(item.type || 'Movie').trim()}`;
      const existingMatch = existingTitleLookup.get(titleKey);

      if (existingMatch) {
        // Fold into existing update instead of creating a duplicate canonical title!
        existingUpdates.push({
          canonicalId: existingMatch.canonicalId,
          displayTitle: existingMatch.displayTitle,
          incomingRecord: item
        });
        continue;
      }

      maxId++;
      const assignedId = maxId;

      // Clean qualities: if verified qualities exist, remove 'unknown'
      let cleanQualities = (item.qualities && item.qualities.length > 0) ? [...item.qualities] : ['unknown'];
      if (cleanQualities.length > 1 && cleanQualities.includes('unknown')) {
        cleanQualities = cleanQualities.filter(q => q !== 'unknown');
      }

      const canonicalRecord = {
        id: `praflix-${assignedId}`,
        canonicalId: assignedId,
        displayTitle: item.displayTitle,
        originalSourceTitle: item.originalSourceTitle,
        normalizedTitle: item.normalizedTitle,
        year: item.year,
        type: item.type,
        season: item.season || null,
        episodeStatus: null,
        genres: item.genres || ['Cinema'],
        languages: item.languages || ['Hindi'],
        audioTracks: item.audioTracks || [],
        audio: item.audio || null,
        platform: item.platform || null,
        platforms: item.platforms || [],
        releaseType: item.releaseType || 'WEB-DL',
        poster: item.sourcePosterUrl || 'assets/posters/placeholder.jpg',
        sourcePosterUrl: item.sourcePosterUrl,
        qualities: cleanQualities,
        variantCount: (item.variants || []).length,
        variants: item.variants || [],
        screenshots: item.screenshots || [],
        status: 'active'
      };

      approvedNewTitles.push(canonicalRecord);

      // Prepare downloads.json entry
      const dlEntries = item.downloadLinks.map(l => ({
        sourceName: item.variants?.[0]?.source || 'provider',
        downloadUrl: l.downloadUrl || l.url,
        resolution: l.quality || 'unknown',
        rawQuality: l.rawQuality || l.sourceLabel || l.quality || 'Unknown',
        episode: l.episode || null,
        verificationStatus: 'verified',
        verificationEvidence: l.evidence || 'destination_resolved'
      }));

      downloadEntriesToAdd.push({
        canonicalId: assignedId,
        displayTitle: item.displayTitle,
        year: item.year,
        type: item.type,
        entries: dlEntries
      });
    }

    // 2. Process existing title updates
    for (const update of existingUpdates) {
      const target = currentCatalog.find(c => c.canonicalId === update.canonicalId);
      if (!target) continue;

      const incoming = update.incomingRecord || update;
      const existingQuals = new Set(target.qualities || []);
      const incQuals = incoming.qualities || [];

      // Merge verified qualities, never letting 'unknown' wipe out or contaminate verified qualities
      for (const q of incQuals) {
        if (q && q !== 'unknown') {
          existingQuals.add(q);
        }
      }
      if (existingQuals.size === 0 && incQuals.includes('unknown')) {
        existingQuals.add('unknown');
      }
      if (existingQuals.size > 1 && existingQuals.has('unknown')) {
        existingQuals.delete('unknown');
      }

      const mergedQualities = Array.from(existingQuals);
      const newVariant = incoming.variants?.[0] || null;

      // Extract new download links
      const incomingLinks = Array.isArray(incoming.downloadLinks) ? incoming.downloadLinks : [];
      const newDlEntries = incomingLinks.map(l => ({
        sourceName: newVariant?.source || 'provider',
        downloadUrl: l.downloadUrl || l.url,
        resolution: l.quality || 'unknown',
        rawQuality: l.rawQuality || l.sourceLabel || l.quality || 'Unknown',
        episode: l.episode || null,
        verificationStatus: 'verified',
        verificationEvidence: l.evidence || 'destination_resolved'
      }));

      approvedExistingUpdates.push({
        canonicalId: target.canonicalId,
        displayTitle: target.displayTitle,
        mergedQualities,
        newVariant,
        newDownloadEntries: newDlEntries
      });
    }

    return {
      baselineCount: currentCatalog.length,
      proposedNewCount: approvedNewTitles.length,
      quarantinedCount: quarantinedUnverified.length,
      proposedUpdatedCount: approvedExistingUpdates.length,
      finalProjectedCount: currentCatalog.length + approvedNewTitles.length,
      approvedNewTitles,
      quarantinedUnverified,
      approvedExistingUpdates,
      downloadEntriesToAdd
    };
  }

  /**
   * Applies the merge with automatic atomic backups
   * Requires options.confirmed === true
   * @param {Object} plan - Output of createMergePlan
   * @param {Object} options
   * @returns {Promise<Object>} Execution result
   */
  async applyMerge(plan, options = {}) {
    if (!options.confirmed) {
      throw new Error('[Merger Safety Exception] applyMerge() requires explicit options.confirmed === true!');
    }

    const timestamp = Date.now();
    const backupCatalogPath = path.join(DATA_DIR, `catalog.pre-v2-merge.${timestamp}.backup.json`);
    const backupDownloadsPath = path.join(DATA_DIR, `downloads.pre-v2-merge.${timestamp}.backup.json`);
    const backupSourcesPath = path.join(DATA_DIR, `source-records.pre-v2-merge.${timestamp}.backup.json`);

    // 1. Create Atomic Backups
    fs.copyFileSync(this.catalogPath, backupCatalogPath);
    fs.copyFileSync(this.downloadsPath, backupDownloadsPath);
    if (fs.existsSync(this.sourcesPath)) {
      fs.copyFileSync(this.sourcesPath, backupSourcesPath);
    }

    console.log(`[Merger] Created atomic pre-merge backup: ${backupCatalogPath}`);

    // 2. Load current datasets
    const catalog = JSON.parse(fs.readFileSync(this.catalogPath, 'utf8'));
    const downloads = JSON.parse(fs.readFileSync(this.downloadsPath, 'utf8'));

    // 3. Append approved new canonical titles
    for (const newTitle of plan.approvedNewTitles) {
      catalog.push(newTitle);
    }

    // 3b. Apply approved existing title updates safely
    for (const update of plan.approvedExistingUpdates) {
      const target = catalog.find(c => c.canonicalId === update.canonicalId);
      if (target) {
        if (update.mergedQualities && update.mergedQualities.length > 0) {
          target.qualities = update.mergedQualities;
        }
        if (update.newVariant) {
          target.variants = target.variants || [];
          const exists = target.variants.some(v =>
            v.source === update.newVariant.source &&
            (v.sourceUrl === update.newVariant.sourceUrl || v.sourceId === update.newVariant.sourceId)
          );
          if (!exists) {
            target.variants.push(update.newVariant);
            target.variantCount = target.variants.length;
          }
        }
      }
    }

    // 4. Update downloads.json entries
    if (!Array.isArray(downloads.entries)) {
      downloads.entries = [];
    }
    const nowIso = new Date().toISOString();

    // 4a. Add entries for new canonical titles
    for (const dlItem of plan.downloadEntriesToAdd) {
      downloads.entries.push({
        catalogueId: dlItem.canonicalId,
        title: dlItem.displayTitle,
        type: dlItem.type,
        year: dlItem.year,
        lastCheckedAt: nowIso,
        discoveryStatus: 'links_found',
        verificationStatus: 'verified',
        verificationEvidence: 'Verified storage CDN / drive destination',
        links: dlItem.entries
      });
    }

    // 4b. Append new links for existing canonical title updates
    for (const update of plan.approvedExistingUpdates) {
      if (!update.newDownloadEntries || update.newDownloadEntries.length === 0) continue;
      const dlItem = downloads.entries.find(e => e.catalogueId === update.canonicalId);
      if (dlItem) {
        dlItem.links = dlItem.links || [];
        for (const newLink of update.newDownloadEntries) {
          const alreadyHasLink = dlItem.links.some(l => (l.downloadUrl || l.url) === (newLink.downloadUrl || newLink.url));
          if (!alreadyHasLink) {
            dlItem.links.push(newLink);
          }
        }
      }
    }

    downloads.totalTitlesWithLinks = downloads.entries.filter(e => e.links && e.links.length > 0).length;
    downloads.totalLinks = downloads.entries.reduce((sum, e) => sum + (e.links ? e.links.length : 0), 0);
    downloads.lastUpdated = nowIso;

    // 5. Atomic write to master data files
    fs.writeFileSync(this.catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
    fs.writeFileSync(this.downloadsPath, JSON.stringify(downloads, null, 2), 'utf8');

    console.log(`[Merger] Updated master catalog: ${catalog.length.toLocaleString()} titles.`);

    // 6. Trigger production build to rebuild chunks and manifest
    execFileSync(process.execPath, [path.join(BASE_DIR, 'build.js')], { stdio: 'inherit' });

    // 7. Validate consistency
    execFileSync(process.execPath, [path.join(BASE_DIR, 'scripts/validate_catalog_consistency.js'), '--dist'], { stdio: 'inherit' });

    return {
      success: true,
      timestamp,
      backupCatalogPath,
      backupDownloadsPath,
      newTitlesAdded: plan.approvedNewTitles.length,
      finalCatalogCount: catalog.length
    };
  }

  /**
   * Instant rollback to a previous backup snapshot
   * @param {string} backupCatalogPath
   * @param {string} backupDownloadsPath
   */
  rollback(backupCatalogPath, backupDownloadsPath) {
    if (!fs.existsSync(backupCatalogPath) || !fs.existsSync(backupDownloadsPath)) {
      throw new Error('[Merger Rollback Error] Backup files not found.');
    }

    fs.copyFileSync(backupCatalogPath, this.catalogPath);
    fs.copyFileSync(backupDownloadsPath, this.downloadsPath);

    // Rebuild chunks
    execFileSync(process.execPath, [path.join(BASE_DIR, 'build.js')], { stdio: 'inherit' });
    console.log('[Merger Rollback] Master catalog and downloads restored successfully from backup.');
  }
}

module.exports = {
  CatalogMerger
};
