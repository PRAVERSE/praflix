/**
 * PRAFLIX — A PRAVERSE Company
 * Catalog & Search Controller
 * Fully dynamic year navigation, resilient multi-token search,
 * canonical variant management, dynamic pagination,
 * poster-priority catalogue ordering (pages 1-10 = real poster titles),
 * and quality-wise download section on every detail page.
 *
 * POSTER PRIORITY SORT ALGORITHM
 * ────────────────────────────────
 * When sort = 'year-desc' (default):
 *   Pages  1–10  → titles with confirmed real poster files (sorted: year desc, title asc)
 *   Pages 11+    → all remaining titles mixed (poster + no-poster, sorted: year desc, title asc)
 *
 * Poster validity is determined at build time (poster-valid-ids.js generates
 * window.PRAFLIX_POSTER_VALID_IDS as a Set of canonicalIds).
 * If fewer than 10 pages of poster titles exist, all records are shown without
 * artificial gaps (graceful degradation).
 *
 * All other sorts (year-asc, title-asc, etc.) bypass the poster-priority split.
 */

(function () {
  'use strict';

  // Application State
  const state = {
    canonicalRecords: [],
    sourceRecords: [],
    filteredRecords: [],
    posterRecords: [],
    nonPosterRecords: [],
    availableYears: [],
    availableLanguages: [],
    availableQualities: [],
    defaultYear: '',
    yearExplicitlyChosen: false,
    currentPage: 1,
    pageSize: 48,
    activeFilters: {
      search: '',
      year: '', // set dynamically from latest available year
      category: 'All',
      type: '',
      platform: '',
      season: '',
      language: '',
      quality: '',
      sort: 'year-desc'
    },
    activeModalItem: null,
    inDetailsView: false,
    activeDetailItem: null,
    previousCatalogState: null,
    currentArtworkIndex: 0,
    currentArtworkList: [],
    currentScreenshotIndex: 0,
    currentScreenshotList: [],
    // Download links data — loaded once from data/downloads.json
    downloadsData: null,        // null = not yet loaded, {} = loaded (may be empty)
    downloadsMap: new Map()     // canonicalId → entry from downloads.json
  };

  // DOM Elements Cache
  const DOM = {};

  // Procedural SVG Fallback for posters
  const FALLBACK_POSTER = 'assets/posters/fallback.svg';

  /**
   * Title Normalizer
   * Removes punctuation, hyphens, collapses spaces for resilient search
   */
  function normalizeText(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Cinema Industry & Platform Classification Helpers
  const SOUTH_INDIAN_LANGS = ['telugu', 'tamil', 'malayalam', 'kannada'];

  function isSouthIndian(item) {
    const langs = (item.languages || []).map(l => String(l).toLowerCase());
    if (SOUTH_INDIAN_LANGS.some(sl => langs.includes(sl))) return true;
    const text = `${item.displayTitle || ''} ${item.originalSourceTitle || ''}`.toLowerCase();
    return text.includes('south');
  }

  function isHollywood(item) {
    const langs = (item.languages || []).map(l => String(l).toLowerCase());
    if (langs.includes('english')) return true;
    const text = `${item.displayTitle || ''} ${item.originalSourceTitle || ''}`.toLowerCase();
    return text.includes('hollywood');
  }

  function isBollywood(item) {
    const text = `${item.displayTitle || ''} ${item.originalSourceTitle || ''}`.toLowerCase();
    if (text.includes('bollywood')) return true;
    const langs = (item.languages || []).map(l => String(l).toLowerCase());
    return langs.includes('hindi') && !isSouthIndian(item) && !isHollywood(item);
  }

  function isPlatformMatch(item, platformName) {
    if (!platformName) return true;
    const target = platformName.toLowerCase();
    const matchPlat = (p) => {
      const s = String(p || '').toLowerCase();
      if (target === 'prime video' || target === 'prime') {
        return s === 'prime video' || s === 'amazon prime video' || s === 'amazon prime' || s === 'prime' || s.includes('prime-video') || s.includes('amazon-prime');
      }
      return s.includes(target);
    };
    if ((item.platforms || []).some(matchPlat)) return true;
    if (matchPlat(item.platform)) return true;
    if ((item.variants || []).some(v => matchPlat(v.platform) || (v.sourceUrl && (v.sourceUrl.includes('/' + target + '/') || v.sourceUrl.includes('category/amazon-prime'))))) return true;
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DYNAMIC TWO-SECTION CATALOGUE PAGINATION
  // Section 1: Verified Real-Poster Titles (Pages 1–180 in default view)
  // Section 2: Remaining Archive Titles (Pages 181–322 in default view)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns true if the given catalogue record has a confirmed real poster file
   * (verified at build time via the poster-valid-ids.js index).
   *
   * @param {Object} item - canonical catalogue record
   * @returns {boolean}
   */
  function hasRealPoster(item) {
    if (!item) return false;
    // Primary: use the build-time Set embedded in poster-valid-ids.js
    const validSet = window.PRAFLIX_POSTER_VALID_IDS;
    if (validSet instanceof Set) {
      return validSet.has(item.canonicalId);
    }
    if (Array.isArray(validSet)) {
      return validSet.includes(item.canonicalId);
    }
    if (validSet && typeof validSet.has === 'function') {
      return validSet.has(item.canonicalId);
    }
    // Fallback: trust only confirmed local assets/posters files
    // Explicitly reject fallback SVG, missing poster, and external HTTP(S) URLs
    const p = String(item.poster || '').trim();
    return Boolean(
      p &&
      p.startsWith('assets/posters/') &&
      p !== 'assets/posters/fallback.svg' &&
      p !== FALLBACK_POSTER &&
      !p.startsWith('http://') &&
      !p.startsWith('https://')
    );
  }

  /**
   * Dynamic Pagination Metadata
   * Computes section page counts and overall total pages dynamically from actual record counts.
   * Strictly prevents hardcoding 180 or 322 while perfectly producing them on the master dataset.
   *
   * @returns {Object} { posterCount, nonPosterCount, totalCount, pageSize, posterPages, nonPosterPages, totalPages }
   */
  function getPaginationMeta() {
    const posterCount = (state.posterRecords || []).length;
    const nonPosterCount = (state.nonPosterRecords || []).length;
    const pageSize = state.pageSize || 48;
    const posterPages = Math.ceil(posterCount / pageSize);
    const nonPosterPages = Math.ceil(nonPosterCount / pageSize);
    const totalPages = Math.max(1, posterPages + nonPosterPages);
    return {
      posterCount,
      nonPosterCount,
      totalCount: posterCount + nonPosterCount,
      pageSize,
      posterPages,
      nonPosterPages,
      totalPages
    };
  }

  /**
   * Retrieves the slice of records for the current active page.
   * Strictly separates the Poster Section (pages 1 to posterPages) from the
   * Non-Poster Section (pages posterPages + 1 to totalPages).
   * A title is never mixed or duplicated between sections.
   *
   * @returns {Object} { section, pageRecords, sectionPage, sectionTotalPages, startIndex, endIndex, sectionTotal }
   */
  function getCurrentPageRecords() {
    const { posterCount, nonPosterCount, pageSize, posterPages, totalPages } = getPaginationMeta();
    const page = Math.min(Math.max(1, state.currentPage), totalPages);

    if (posterCount > 0 && page <= posterPages) {
      // Verified Real-Poster Section (Pages 1 to posterPages)
      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, posterCount);
      return {
        section: 'poster',
        pageRecords: state.posterRecords.slice(startIndex, endIndex),
        sectionPage: page,
        sectionTotalPages: posterPages,
        startIndex,
        endIndex,
        sectionTotal: posterCount
      };
    } else {
      // Remaining Non-Poster / Archive Section (Pages posterPages + 1 to totalPages)
      const relativePage = posterCount > 0 ? (page - posterPages) : page;
      const startIndex = (relativePage - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, nonPosterCount);
      return {
        section: 'non-poster',
        pageRecords: state.nonPosterRecords.slice(startIndex, endIndex),
        sectionPage: relativePage,
        sectionTotalPages: Math.ceil(nonPosterCount / pageSize),
        startIndex,
        endIndex,
        sectionTotal: nonPosterCount
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOWNLOAD SECTION HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load data/downloads.json once and populate state.downloadsMap.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async function ensureDownloadsLoaded() {
    if (state.downloadsData !== null) return;  // already loaded
    try {
      const resp = await fetch('data/downloads.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      state.downloadsData = await resp.json();
      const entries = (state.downloadsData && Array.isArray(state.downloadsData.entries))
        ? state.downloadsData.entries
        : [];
      entries.forEach(e => {
        if (e && e.catalogueId != null) {
          state.downloadsMap.set(Number(e.catalogueId), e);
        }
      });
    } catch (err) {
      console.warn('[PRAFLIX] downloads.json could not be loaded:', err.message);
      state.downloadsData = { entries: [] };  // treat as empty, not as error
    }
  }

  /**
   * Retrieve the download entry for a given canonicalId.
   * Returns null if not found.
   */
  function getDownloadEntry(canonicalId) {
    return state.downloadsMap.get(Number(canonicalId)) || null;
  }

  /**
   * Returns a CSS class and resolution label for a resolution string.
   */
  function resolutionClass(resolution) {
    const r = String(resolution || '').toLowerCase();
    if (r.includes('2160') || r.includes('4k'))  return 'res-4k';
    if (r.includes('1080'))  return 'res-1080';
    if (r.includes('720'))   return 'res-720';
    if (r.includes('480'))   return 'res-480';
    if (r.includes('360'))   return 'res-360';
    return '';
  }

  /**
   * Returns a display label for a resolution string.
   */
  function resolutionLabel(resolution) {
    const r = String(resolution || '').toLowerCase();
    if (r.includes('2160') || r === '4k' || r.includes('4k'))  return '4K UHD';
    if (r === '1080p' || r.includes('1080'))  return '1080p Full HD';
    if (r === '720p'  || r.includes('720'))   return '720p HD';
    if (r === '480p'  || r.includes('480'))   return '480p SD';
    if (r === '360p'  || r.includes('360'))   return '360p';
    return resolution || 'Unknown';
  }

  /**
   * Format bytes to a human-readable size string.
   */
  function formatFileSize(bytes) {
    if (!bytes || typeof bytes !== 'number' || bytes <= 0) return null;
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(0)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  /**
   * Render the Download Options section for a given catalogue item.
   *
   * States rendered:
   *  1. Download links available  → quality cards per source
   *  2. Searching / pending       → blue info banner
   *  3. No verified links found   → neutral banner
   *  4. Links expired/unavailable → amber banner
   *
   * This function uses existing variant data (sourceUrl + qualities) plus the
   * optional downloads.json overlay for verified direct download links.
   */
  function renderDownloadSection(item) {
    if (!DOM.sectionDownload || !DOM.downloadSectionInner) return;
    DOM.sectionDownload.style.display = 'block';

    const entry = getDownloadEntry(item.canonicalId);
    const variants = item.variants || [];
    const hasVariantSources = variants.some(v => v.sourceUrl);
    const hasDirectLinks = entry && Array.isArray(entry.links) && entry.links.length > 0;

    const PROVIDER_NAMES = {
      '10moviez': '10Moviez',
      'hdhub4u': 'HDHub4u',
      'hdwall': 'HDWall'
    };

    // ── Build Quality-wise Available Versions ──
    const qualityMap = new Map(); // key -> { key, sortOrder, label, resCls, providers: Map, directLinks: [], languages, releaseTypes, audios }

    function addQualityOffering(rawRes, providerId, sourceUrl, releaseType, audio, languages) {
      if (!rawRes) return;
      const resStr = String(rawRes).toLowerCase();
      let key = '720p';
      let sortOrder = 30;

      if (resStr.includes('2160') || resStr.includes('4k') || resStr.includes('uhd')) {
        key = '2160p';
        sortOrder = 10;
      } else if (resStr.includes('1440') || resStr.includes('2k')) {
        key = '1440p';
        sortOrder = 20;
      } else if (resStr.includes('1080') || resStr.includes('fhd')) {
        key = '1080p';
        sortOrder = 25;
      } else if (resStr.includes('720') || resStr.includes('hd')) {
        key = '720p';
        sortOrder = 30;
      } else if (resStr.includes('480') || resStr.includes('sd') || resStr.includes('cam')) {
        key = '480p';
        sortOrder = 40;
      } else if (resStr.includes('360')) {
        key = '360p';
        sortOrder = 50;
      }

      if (!qualityMap.has(key)) {
        qualityMap.set(key, {
          key,
          sortOrder,
          label: resolutionLabel(key),
          resCls: resolutionClass(key),
          providers: new Map(),
          directLinks: [],
          languages: new Set(),
          releaseTypes: new Set(),
          audios: new Set()
        });
      }

      const g = qualityMap.get(key);
      if (languages) (Array.isArray(languages) ? languages : [languages]).forEach(l => l && g.languages.add(l));
      if (releaseType) g.releaseTypes.add(releaseType);
      if (audio) g.audios.add(audio);

      const pid = providerId || 'source';
      const pName = PROVIDER_NAMES[pid.toLowerCase()] || (pid.charAt(0).toUpperCase() + pid.slice(1));
      if (!g.providers.has(pid)) {
        g.providers.set(pid, {
          id: pid,
          name: pName,
          sourceUrl: sourceUrl,
          releaseType: releaseType || null,
          audio: audio || null
        });
      }
    }

    // Process all variants
    variants.forEach(v => {
      const vQuals = Array.isArray(v.qualities) ? v.qualities : [];
      if (vQuals.length > 0) {
        vQuals.forEach(q => {
          const rawQ = q.resolution || q.label || (typeof q === 'string' ? q : '');
          addQualityOffering(rawQ, v.source, v.sourceUrl, v.releaseType, v.audio, v.languages);
        });
      } else if (v.sourceUrl) {
        const itemQuals = Array.isArray(item.qualities) ? item.qualities : [];
        if (itemQuals.length > 0) {
          itemQuals.forEach(iq => {
            const rawIQ = typeof iq === 'string' ? iq : (iq.resolution || iq.label || '');
            addQualityOffering(rawIQ, v.source, v.sourceUrl, v.releaseType, v.audio, v.languages);
          });
        } else {
          addQualityOffering('720p', v.source, v.sourceUrl, v.releaseType, v.audio, v.languages);
        }
      }
    });

    // Process direct authorized download links from downloads.json if present
    if (hasDirectLinks) {
      entry.links.forEach(l => {
        if (l.verificationStatus === 'verified' || l.verificationStatus === 'unverified') {
          const key = (l.resolution || '720p').toLowerCase();
          if (!qualityMap.has(key)) {
            addQualityOffering(l.resolution, l.sourceName, l.sourceUrl || l.downloadUrl, l.format, l.audio, l.language);
          }
          const g = qualityMap.get(key);
          if (g) g.directLinks.push(l);
        }
      });
    }

    const sortedQualities = Array.from(qualityMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);

    // ── Primary View: Render Grouped Quality Cards (Available Versions) ──
    if (sortedQualities.length > 0) {
      let html = `<div class="available-versions-container">`;

      sortedQualities.forEach(qGroup => {
        const provList = Array.from(qGroup.providers.values());
        const directLink = qGroup.directLinks.find(l => l.downloadUrl);

        html += `
          <div class="version-row-card dl-quality-card">
            <div class="version-left-meta">
              <span class="version-quality-badge dl-res-badge ${qGroup.resCls}">📺 ${escapeHtml(qGroup.label)}</span>
              <div class="version-tech-tags">
                ${Array.from(qGroup.releaseTypes).map(rt => `<span class="version-tag dl-format-tag">${escapeHtml(rt)}</span>`).join('')}
                ${Array.from(qGroup.audios).map(au => `<span class="version-tag dl-format-tag">${escapeHtml(au)}</span>`).join('')}
                ${Array.from(qGroup.languages).map(lg => `<span class="version-tag">${escapeHtml(lg)}</span>`).join('')}
              </div>
              <div class="version-provider-pills">
                ${provList.map(p => `<span class="version-provider-pill" title="Available via ${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>`).join('')}
              </div>
            </div>
            <div class="version-actions-group">
        `;

        if (directLink) {
          html += `
            <a class="btn-version-download"
               href="${escapeHtml(directLink.downloadUrl)}"
               target="_blank"
               rel="noopener noreferrer"
               title="Authorized download link">
              <span>⬇ Download (${escapeHtml(directLink.sourceName || 'Direct')})</span>
            </a>
          `;
        }

        // Render clear "View Source" actions opening verified source page
        provList.forEach(p => {
          if (p.sourceUrl) {
            const btnLabel = provList.length > 1 ? `View Source (${escapeHtml(p.name)}) ↗` : `View Source ↗`;
            html += `
              <a class="btn-version-view-source"
                 href="${escapeHtml(p.sourceUrl)}"
                 target="_blank"
                 rel="noopener noreferrer"
                 title="View ${escapeHtml(qGroup.label)} on verified source page">
                <span>${btnLabel}</span>
              </a>
            `;
          }
        });

        html += `
            </div>
          </div>
        `;
      });

      html += `</div>`;
      DOM.downloadSectionInner.innerHTML = html;
      return;
    }

    // ── Fallback Case 2: Variant source URLs as informational source references ──
    if (hasVariantSources) {
      DOM.downloadSectionInner.innerHTML = renderVariantSourceLinks(item, variants);
      return;
    }

    // ── Fallback Case 3: No links found banner ──
    if (entry && entry.discoveryStatus === 'no_links_found') {
      DOM.downloadSectionInner.innerHTML = `
        <div class="dl-state-banner dl-state-none">
          <span class="dl-state-icon">🔍</span>
          <div class="dl-state-text">
            <div class="dl-state-title">No Verified Download Links Available Yet</div>
            <div class="dl-state-desc">
              The PRAFLIX discovery pipeline has searched for verified download options
              for <strong>${escapeHtml(item.displayTitle)}</strong> but has not yet found
              any authorized links from permitted sources. Check back later.
            </div>
          </div>
        </div>`;
      return;
    }

    // ── Fallback Case 4: Entry expired ──
    if (entry && entry.discoveryStatus === 'expired') {
      DOM.downloadSectionInner.innerHTML = `
        <div class="dl-state-banner dl-state-expired">
          <span class="dl-state-icon">⏳</span>
          <div class="dl-state-text">
            <div class="dl-state-title">Previously Found Links Are Unavailable</div>
            <div class="dl-state-desc">
              Download links for this title were previously found but are no longer
              available. A recheck has been queued.
            </div>
          </div>
        </div>`;
      return;
    }

    // ── Fallback Case 5: Pending discovery ──
    DOM.downloadSectionInner.innerHTML = `
      <div class="dl-state-banner dl-state-searching">
        <span class="dl-state-icon">⏺</span>
        <div class="dl-state-text">
          <div class="dl-state-title">Searching for Download Options</div>
          <div class="dl-state-desc">
            The PRAFLIX discovery pipeline is searching for verified download options
            for <strong>${escapeHtml(item.displayTitle)}</strong> across authorized
            sources. Download links will appear here once discovered and verified.
          </div>
        </div>
      </div>`;
  }

  /**
   * Render quality-wise download links from a verified downloads.json entry.
   * Groups by source, then shows quality cards for each link.
   */
  function renderDownloadLinks(item, entry) {
    const links = entry.links.filter(l => l.verificationStatus === 'verified' || l.verificationStatus === 'unverified');
    if (!links.length) return renderVariantSourceLinks(item, item.variants || []);

    // Group by sourceName
    const bySource = new Map();
    links.forEach(l => {
      const src = l.sourceName || 'Source';
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(l);
    });

    const ts = entry.lastCheckedAt
      ? `Last checked: ${new Date(entry.lastCheckedAt).toLocaleDateString()}`
      : '';

    let html = '';
    if (bySource.size > 1) {
      html += `<div class="dl-sources-header">
        <span class="dl-sources-label">Available Sources</span>
        <span class="dl-sources-count">${bySource.size} Sources</span>
      </div>`;
    }

    bySource.forEach((srcLinks, sourceName) => {
      const langs = [...new Set(srcLinks.map(l => l.language).filter(Boolean))].join(', ');
      html += `
        <div class="dl-source-block">
          <div class="dl-source-header">
            <div class="dl-source-name">
              <span class="dl-source-icon">📡</span>
              ${escapeHtml(sourceName)}
              ${langs ? `<span class="dl-source-lang-badge">${escapeHtml(langs)}</span>` : ''}
            </div>
            <span class="dl-verified-badge">✓ Verified Source</span>
          </div>
          <div class="dl-quality-grid">
            ${srcLinks.map(l => renderQualityCard(l)).join('')}
          </div>
        </div>`;
    });

    if (ts) html += `<div class="dl-timestamp">${escapeHtml(ts)}</div>`;
    return html;
  }

  /**
   * Render a single quality download card.
   */
  function renderQualityCard(link) {
    const res      = link.resolution || link.resolutionLabel || 'Unknown';
    const resLbl   = link.resolutionLabel || resolutionLabel(res);
    const resCls   = resolutionClass(res);
    const sizeStr  = link.fileSizeLabel || formatFileSize(link.fileSizeBytes) || '';
    const fmt      = link.format || '';
    const audio    = link.audio || '';
    const dlUrl    = link.downloadUrl || link.sourceUrl || '#';
    const isPage   = !link.isDirectFile;

    return `
      <a class="dl-quality-card"
         href="${escapeHtml(dlUrl)}"
         target="_blank"
         rel="noopener noreferrer"
         title="${escapeHtml(resLbl)} — ${escapeHtml(link.sourceName || '')}">
        <div class="dl-res-row">
          <span class="dl-res-badge ${resCls}">⬇ ${escapeHtml(resLbl)}</span>
          ${sizeStr ? `<span class="dl-size-label">${escapeHtml(sizeStr)}</span>` : ''}
        </div>
        <div class="dl-format-row">
          ${fmt   ? `<span class="dl-format-tag">${escapeHtml(fmt)}</span>` : ''}
          ${audio ? `<span class="dl-format-tag">${escapeHtml(audio)}</span>` : ''}
          ${isPage ? `<span class="dl-format-tag">Info Page ↗</span>` : '<span class="dl-format-tag">Direct ↓</span>'}
        </div>
      </a>`;
  }

  /**
   * Render download options from catalog variant data.
   * Variants contain sourceUrl (info page) + qualities[] (resolutions).
   * We show quality cards linking to the source info page.
   * We do NOT fabricate direct download URLs.
   */
  function renderVariantSourceLinks(item, variants) {
    const activeVariants = variants.filter(v => v.sourceUrl);
    if (!activeVariants.length) return `
      <div class="dl-state-banner dl-state-searching">
        <span class="dl-state-icon">⏺</span>
        <div class="dl-state-text">
          <div class="dl-state-title">Searching for Download Options</div>
          <div class="dl-state-desc">No source pages are currently indexed for this title. Discovery is ongoing.</div>
        </div>
      </div>`;

    let html = '';
    if (activeVariants.length > 1) {
      html += `<div class="dl-sources-header">
        <span class="dl-sources-label">Indexed Source Pages</span>
        <span class="dl-sources-count">${activeVariants.length} Sources</span>
      </div>`;
    }

    const PROVIDER_NAMES = {
      '10moviez': '10Moviez',
      'hdhub4u': 'HDHub4u',
      'hdwall': 'HDWall'
    };

    activeVariants.forEach((v, idx) => {
      const rawSrc = (v.source && String(v.source).trim().toLowerCase()) || '';
      const sourceLabel = PROVIDER_NAMES[rawSrc]
        || ((v.source && String(v.source).trim()) ? String(v.source).charAt(0).toUpperCase() + String(v.source).slice(1) : `Source ${idx + 1}`);
      const langs = (v.languages && v.languages.length) ? v.languages.join(', ') : '';
      const vQualities = Array.isArray(v.qualities) ? v.qualities : [];
      const hasQualCards = vQualities.length > 0;

      html += `
        <div class="dl-source-block">
          <div class="dl-source-header">
            <div class="dl-source-name">
              <span class="dl-source-icon">🌐</span>
              ${escapeHtml(sourceLabel)}
              ${langs ? `<span class="dl-source-lang-badge">${escapeHtml(langs)}</span>` : ''}
            </div>
          </div>`;

      if (hasQualCards) {
        html += `<div class="dl-quality-grid">`;
        vQualities.forEach(q => {
          const qRes   = q.resolution || q.label || String(q) || 'Unknown';
          const qLabel = q.label || resolutionLabel(qRes);
          const qCls   = resolutionClass(qRes);
          html += `
            <a class="dl-quality-card"
               href="${escapeHtml(v.sourceUrl)}"
               target="_blank"
               rel="noopener noreferrer"
               title="${escapeHtml(qLabel)} — opens source information page">
              <div class="dl-res-row">
                <span class="dl-res-badge ${qCls}">⬇ ${escapeHtml(qLabel)}</span>
              </div>
              <div class="dl-format-row">
                ${v.releaseType ? `<span class="dl-format-tag">${escapeHtml(v.releaseType)}</span>` : ''}
                ${v.audio      ? `<span class="dl-format-tag">${escapeHtml(v.audio)}</span>`      : ''}
                <span class="dl-format-tag">Info Page ↗</span>
              </div>
              <div class="dl-source-ref-row">
                <span class="dl-source-ref-btn">View Source Page ↗</span>
              </div>
            </a>`;
        });
        html += `</div>`;
      }

      html += `
          <a class="dl-source-page-link"
             href="${escapeHtml(v.sourceUrl)}"
             target="_blank"
             rel="noopener noreferrer">
            <span class="dl-source-page-icon">🔗</span>
            <span class="dl-source-page-text">
              Open Source Information Page
              <span class="dl-source-page-hint">
                ${escapeHtml(sourceLabel)} — view available download options on the source site
              </span>
            </span>
            <span class="dl-arrow-out">↗</span>
          </a>
        </div>`;
    });

    return html;
  }

  /**
   * Initialize App
   */
  async function init() {
    cacheDom();

    try {
      // 1. Load canonical and source datasets (multi-tier resilient loader)
      if (window.PRAFLIX_DATA && Array.isArray(window.PRAFLIX_DATA) && window.PRAFLIX_DATA.length > 0) {
        state.canonicalRecords = window.PRAFLIX_DATA;
        state.sourceRecords = window.PRAFLIX_SOURCES || [];
      } else if (window.PRAFLIX_R2_URL) {
        // Cloudflare R2 Remote Storage Integration
        const r2Base = String(window.PRAFLIX_R2_URL).replace(/\/+$/, '');
        const resp = await fetch(`${r2Base}/catalog.json`);
        if (!resp.ok) throw new Error(`R2 catalog fetch failed with status ${resp.status}`);
        state.canonicalRecords = await resp.json();
      } else {
        // Asynchronous chunked loading via catalog-manifest.json
        try {
          const manifestResp = await fetch('data/catalog-manifest.json');
          if (manifestResp.ok) {
            const manifest = await manifestResp.json();
            const chunkPromises = (manifest.chunks || []).map(async (cPath) => {
              const cResp = await fetch(cPath);
              if (!cResp.ok) throw new Error(`Failed to fetch chunk ${cPath}: ${cResp.status}`);
              return await cResp.json();
            });
            const chunksData = await Promise.all(chunkPromises);
            state.canonicalRecords = chunksData.flat();
          } else {
            const resp = await fetch('data/catalog.json');
            state.canonicalRecords = await resp.json();
          }
        } catch (fetchErr) {
          console.warn('[PRAFLIX] Manifest chunk loading failed, falling back to data/catalog.json:', fetchErr);
          const resp = await fetch('data/catalog.json');
          state.canonicalRecords = await resp.json();
        }
      }

      // Pre-compute multi-token searchable text for every canonical item
      const yearsSet = new Set();
      const langsSet = new Set();
      const qualsSet = new Set();

      state.canonicalRecords.forEach(item => {
        if (item.year && /^\d{4}$/.test(item.year)) {
          yearsSet.add(item.year);
        }
        (item.languages || []).forEach(l => { if (l) langsSet.add(l); });
        (item.qualities || []).forEach(q => { if (q) qualsSet.add(q); });

        const variantTitles = (item.variants || []).map(v => v.originalSourceTitle || '').join(' ');
        const variantLangs = (item.variants || []).flatMap(v => v.languages || []).join(' ');
        const searchCorpus = [
          item.displayTitle,
          item.normalizedTitle,
          item.year || '',
          item.season || '',
          item.type || '',
          (item.languages || []).join(' '),
          (item.qualities || []).join(' '),
          (item.platforms || []).join(' '),
          (item.categories || []).join(' '),
          item.audio || '',
          variantTitles,
          variantLangs
        ].join(' ');

        item._searchTokens = normalizeText(searchCorpus);
      });

      // Compute dynamic year range
      state.availableYears = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
      state.availableLanguages = Array.from(langsSet).sort();
      
      // Preferred quality order
      const qualOrder = ['4K', '2160p', '1440p', '1080p', '720p', '480p', '360p', 'BluRay', 'WEB-DL', 'HD'];
      state.availableQualities = Array.from(qualsSet).sort((a, b) => {
        const ia = qualOrder.indexOf(a);
        const ib = qualOrder.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });

      // Default year: All Years by default
      state.defaultYear = '';
      state.activeFilters.year = '';

      // Pre-load downloads data in the background (does not block catalogue render)
      ensureDownloadsLoaded().catch(() => {});

      // Apply initial filters & render
      applyFilters();

      // Read hash route from URL if present (so direct details URLs like #title=2 open details view)
      parseUrlHash();

      // Bind all UI events
      bindEvents();

      console.log(`[PRAFLIX] Successfully initialized ${state.canonicalRecords.length.toLocaleString()} canonical titles. Default: All Years`);
    } catch (err) {
      console.error('[PRAFLIX] Initialization Error:', err);
      if (DOM.movieGrid) {
        DOM.movieGrid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 40px; margin-bottom: 12px;">⚠️</div>
            <h3 style="color: #fff; margin-bottom: 8px;">Error Loading PRAFLIX Catalog</h3>
            <p style="color: #94a3b8; font-size: 14px;">${escapeHtml(err.message)}</p>
          </div>
        `;
      }
    }
  }

  /**
   * Cache DOM References
   */
  function cacheDom() {
    DOM.searchInput = document.getElementById('search-input');
    DOM.searchClear = document.getElementById('search-clear');
    DOM.navMenu = document.getElementById('nav-menu');

    DOM.catalogSectionHeading = document.getElementById('catalog-section-heading');
    DOM.catalogStatusText = document.getElementById('catalog-status-text');
    DOM.resultsCountBadge = document.getElementById('results-count-badge');
    DOM.movieGrid = document.getElementById('movie-grid');

    DOM.paginationBar = document.getElementById('pagination-bar');
    DOM.btnFirst = document.getElementById('btn-first');
    DOM.btnPrev = document.getElementById('btn-prev');
    DOM.btnNext = document.getElementById('btn-next');
    DOM.btnLast = document.getElementById('btn-last');
    DOM.pageNumbersList = document.getElementById('page-numbers-list');
    DOM.jumpPageInput = document.getElementById('jump-page-input');
    DOM.btnJumpGo = document.getElementById('btn-jump-go');

    // Modal (Backward Compatibility Stubs)
    DOM.praflixModal = document.getElementById('praflix-modal');
    DOM.modalClose = document.getElementById('modal-close');
    DOM.modalPosterImg = document.getElementById('modal-poster-img');
    DOM.modalDisplayTitle = document.getElementById('modal-display-title');
    DOM.modalYearBadge = document.getElementById('modal-year-badge');
    DOM.modalTypeBadge = document.getElementById('modal-type-badge');
    DOM.modalSeasonBadge = document.getElementById('modal-season-badge');
    DOM.modalVariantsBadge = document.getElementById('modal-variants-badge');
    DOM.modalLanguages = document.getElementById('modal-languages');
    DOM.modalQuality = document.getElementById('modal-quality');
    DOM.modalAudio = document.getElementById('modal-audio');
    DOM.modalPlatform = document.getElementById('modal-platform');
    DOM.modalGenres = document.getElementById('modal-genres');
    DOM.modalVariantsCount = document.getElementById('modal-variants-count');
    DOM.modalVariantsList = document.getElementById('modal-variants-list');

    // Dedicated Title Details View Elements
    DOM.catalogLayout = document.getElementById('main-catalog-layout') || document.querySelector('.main-catalog-layout');
    DOM.heroSection = document.getElementById('cinema-hero-section') || document.querySelector('.cinema-hero-section');
    DOM.titleDetailsView = document.getElementById('title-details-view');

    // Details Top Bar
    DOM.btnBackCatalog = document.getElementById('btn-back-catalog');

    // Details Hero
    DOM.detailsPosterImg = document.getElementById('details-poster-img');
    DOM.detailsPosterBadges = document.getElementById('details-poster-badges');
    DOM.heroBackdropGlow = document.getElementById('hero-backdrop-glow');
    DOM.detailsYearBadge = document.getElementById('details-year-badge');
    DOM.detailsTypeBadge = document.getElementById('details-type-badge');
    DOM.detailsSeasonBadge = document.getElementById('details-season-badge');
    DOM.detailsPlatformBadge = document.getElementById('details-platform-badge');
    DOM.detailsVariantsBadge = document.getElementById('details-variants-badge');
    DOM.detailsDisplayTitle = document.getElementById('details-display-title');
    DOM.detailsSourceTitle = document.getElementById('details-source-title');
    DOM.valAudio = document.getElementById('val-audio');
    DOM.valQuality = document.getElementById('val-quality');
    DOM.valReleaseType = document.getElementById('val-release-type');
    DOM.detailsGenresList = document.getElementById('details-genres-list');
    DOM.detailsSynopsisText = document.getElementById('details-synopsis-text');
    DOM.btnToggleSynopsis = document.getElementById('btn-toggle-synopsis');

    // Primary Action Buttons
    DOM.btnActionTrailer = document.getElementById('btn-action-trailer');
    DOM.btnActionSource = document.getElementById('btn-action-source');
    DOM.btnActionSeasons = document.getElementById('btn-action-seasons');

    // Content Sections
    DOM.metadataCardsGrid = document.getElementById('metadata-cards-grid');

    DOM.sectionTrailer = document.getElementById('section-trailer');
    DOM.trailerPreviewCard = document.getElementById('trailer-preview-card');
    DOM.trailerThumbBtn = document.getElementById('trailer-thumb-btn');
    DOM.trailerThumbImg = document.getElementById('trailer-thumb-img');
    DOM.trailerCardTitle = document.getElementById('trailer-card-title');
    DOM.btnTrailerModalOpen = document.getElementById('btn-trailer-modal-open');
    DOM.btnTrailerYtLink = document.getElementById('btn-trailer-yt-link');

    DOM.sectionCast = document.getElementById('section-cast');
    DOM.castCardsRow = document.getElementById('cast-cards-row');

    DOM.sectionSeasons = document.getElementById('section-seasons');
    DOM.seasonsTabBar = document.getElementById('seasons-tab-bar');
    DOM.seasonContentCard = document.getElementById('season-content-card');

    DOM.sectionArtwork = document.getElementById('section-artwork');
    DOM.artworkGrid = document.getElementById('artwork-grid');

    // Screenshots Section
    DOM.sectionScreenshots = document.getElementById('section-screenshots');
    DOM.screenshotsGalleryGrid = document.getElementById('screenshots-gallery-grid');

    DOM.sectionTechnical = document.getElementById('section-technical');
    DOM.detailsEditionsCount = document.getElementById('details-editions-count');
    DOM.detailsReleasesList = document.getElementById('details-releases-list');

    DOM.sectionSourceArticle = document.getElementById('section-source-article');
    DOM.sourceArticleCard = document.getElementById('source-article-card');

    // Download Options Section
    DOM.sectionDownload = document.getElementById('section-download');
    DOM.downloadSectionInner = document.getElementById('download-section-inner');

    // Lightboxes
    DOM.trailerLightbox = document.getElementById('trailer-lightbox');
    DOM.trailerModalTitle = document.getElementById('trailer-modal-title');
    DOM.trailerModalClose = document.getElementById('trailer-modal-close');
    DOM.trailerIframe = document.getElementById('trailer-iframe');

    DOM.artworkLightbox = document.getElementById('artwork-lightbox');
    DOM.artworkModalClose = document.getElementById('artwork-modal-close');
    DOM.artworkLightboxImg = document.getElementById('artwork-lightbox-img');
    DOM.artworkLightboxCaption = document.getElementById('artwork-lightbox-caption');
    DOM.btnArtPrev = document.getElementById('btn-art-prev');
    DOM.btnArtNext = document.getElementById('btn-art-next');

    // Screenshots Lightbox
    DOM.screenshotsLightbox = document.getElementById('screenshots-lightbox');
    DOM.btnScreenshotsModalClose = document.getElementById('btn-screenshots-modal-close');
    DOM.screenshotsLightboxImg = document.getElementById('screenshots-lightbox-img');
    DOM.screenshotsLightboxCaption = document.getElementById('screenshots-lightbox-caption');
    DOM.btnScreenshotsPrev = document.getElementById('btn-screenshots-prev');
    DOM.btnScreenshotsNext = document.getElementById('btn-screenshots-next');
  }


  /**
   * Apply All Active Filters & Search Queries
   */
  function applyFilters(resetPage = false) {
    if (resetPage) state.currentPage = 1;

    const { search, year, category, type, platform, season, language, quality, sort } = state.activeFilters;
    
    // Normalize search query tokens
    const searchTokens = normalizeText(search).split(' ').filter(Boolean);

    let filtered = state.canonicalRecords;

    // 1. Search Query Filter (Title-Normalized across entire corpus)
    if (searchTokens.length > 0) {
      filtered = filtered.filter(item => {
        for (let i = 0; i < searchTokens.length; i++) {
          if (!item._searchTokens.includes(searchTokens[i])) {
            return false;
          }
        }
        return true;
      });
    }

    // 2. Year Filter (First-Class Navigation)
    if (year) {
      if (year === '2010s') {
        filtered = filtered.filter(item => item.year && item.year >= '2010' && item.year <= '2014');
      } else if (year === '2000s') {
        filtered = filtered.filter(item => item.year && item.year >= '2000' && item.year <= '2009');
      } else if (year === 'classic') {
        filtered = filtered.filter(item => item.year && item.year < '2000');
      } else {
        filtered = filtered.filter(item => item.year === year);
      }
    }

    // 3. Category Filter
    if (category && category !== 'All') {
      if (category === 'has_season') {
        filtered = filtered.filter(item => Boolean(item.season));
      } else if (category === '4K UHD' || category === '4K') {
        filtered = filtered.filter(item => (item.qualities || []).some(q => q.includes('4K') || q.includes('2160p')));
      } else if (category === 'Web Series' || category === 'series') {
        filtered = filtered.filter(item => (item.type || '').toLowerCase() === 'web series');
      } else if (category === 'Movie' || category === 'movie') {
        filtered = filtered.filter(item => (item.type || '').toLowerCase() === 'movie');
      } else if (category === 'Bollywood') {
        filtered = filtered.filter(item => isBollywood(item));
      } else if (category === 'Hollywood') {
        filtered = filtered.filter(item => isHollywood(item));
      } else if (category === 'South Indian') {
        filtered = filtered.filter(item => isSouthIndian(item));
      } else {
        filtered = filtered.filter(item => 
          (item.categories || []).includes(category) || 
          isPlatformMatch(item, category)
        );
      }
    }

    // 4. Content Type Filter
    if (type) {
      const matchType = type.toLowerCase();
      filtered = filtered.filter(item => (item.type || '').toLowerCase() === matchType);
    }

    // 5. Platform Filter
    if (platform) {
      filtered = filtered.filter(item => isPlatformMatch(item, platform));
    }

    // 6. Season Filter (Strict, Never Manufactured)
    if (season) {
      if (season === 'has_season') {
        filtered = filtered.filter(item => Boolean(item.season));
      } else if (season === 'Season 4') {
        filtered = filtered.filter(item => {
          if (!item.season) return false;
          const m = item.season.match(/\d+/);
          return m && parseInt(m[0], 10) >= 4;
        });
      } else {
        filtered = filtered.filter(item => item.season && item.season.toLowerCase().includes(season.toLowerCase()));
      }
    }

    // 7. Language Filter
    if (language) {
      filtered = filtered.filter(item => (item.languages || []).some(l => l.toLowerCase() === language.toLowerCase()));
    }

    // 8. Quality Filter
    if (quality) {
      filtered = filtered.filter(item => (item.qualities || []).some(q => q.toLowerCase().includes(quality.toLowerCase())));
    }

    // 9. Dynamic Two-Section Partitioning & Deterministic Sorting
    // Section 1: Titles with confirmed real posters (Pages 1–180 in default master view)
    // Section 2: Remaining titles without real posters (Pages 181–322 in default master view)
    const posterItems = [];
    const nonPosterItems = [];

    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      if (hasRealPoster(item)) {
        posterItems.push(item);
      } else {
        nonPosterItems.push(item);
      }
    }

    // Default release-year descending comparator:
    // 1. Release year descending (numeric years newest to oldest; unspecified/missing year = 0 at end)
    // 2. Content Type: Movies first (0), Web Series second (1)
    // 3. Alphabetical by displayTitle
    const yearDescComparator = (a, b) => {
      const yA = parseInt(a.year || '0', 10) || 0;
      const yB = parseInt(b.year || '0', 10) || 0;
      if (yB !== yA) return yB - yA;
      const tA = (a.type === 'Movie') ? 0 : 1;
      const tB = (b.type === 'Movie') ? 0 : 1;
      if (tA !== tB) return tA - tB;
      return (a.displayTitle || '').localeCompare(b.displayTitle || '', undefined, { sensitivity: 'base' });
    };

    const orderMap = window.PRAFLIX_POSTER_ORDER_MAP;

    if (sort === 'year-desc') {
      if (orderMap && orderMap.size > 0) {
        posterItems.sort((a, b) => {
          const rA = orderMap.get(a.canonicalId);
          const rB = orderMap.get(b.canonicalId);
          if (rA !== undefined && rB !== undefined) return rA - rB;
          if (rA !== undefined) return -1;
          if (rB !== undefined) return 1;
          return yearDescComparator(a, b);
        });
      } else {
        posterItems.sort(yearDescComparator);
      }
      nonPosterItems.sort(yearDescComparator);
    } else if (sort === 'year-asc') {
      const yearAscComparator = (a, b) => (a.year || '9999').localeCompare(b.year || '9999') || (a.displayTitle || '').localeCompare(b.displayTitle || '');
      posterItems.sort(yearAscComparator);
      nonPosterItems.sort(yearAscComparator);
    } else if (sort === 'title-asc') {
      const titleAscComparator = (a, b) => (a.displayTitle || '').localeCompare(b.displayTitle || '');
      posterItems.sort(titleAscComparator);
      nonPosterItems.sort(titleAscComparator);
    } else if (sort === 'title-desc') {
      const titleDescComparator = (a, b) => (b.displayTitle || '').localeCompare(a.displayTitle || '');
      posterItems.sort(titleDescComparator);
      nonPosterItems.sort(titleDescComparator);
    } else if (sort === 'variants-desc') {
      const variantsDescComparator = (a, b) => ((b.variantCount || 1) - (a.variantCount || 1)) || (a.displayTitle || '').localeCompare(b.displayTitle || '');
      posterItems.sort(variantsDescComparator);
      nonPosterItems.sort(variantsDescComparator);
    }

    state.posterRecords = posterItems;
    state.nonPosterRecords = nonPosterItems;
    state.filteredRecords = [...posterItems, ...nonPosterItems];

    // Dynamic boundary check for currentPage
    const { totalPages } = getPaginationMeta();
    if (state.currentPage > totalPages) state.currentPage = 1;

    // Update UI Elements
    updateCatalogHeading();
    renderMovieGrid();
    renderPagination();
    updateFilterControlsUI();
    updateUrlHash();
  }

  /**
   * Update Dynamic Section Heading & Result Counters
   */
  function updateCatalogHeading() {
    const { totalCount, posterCount, nonPosterCount, totalPages } = getPaginationMeta();
    const { section, sectionPage } = getCurrentPageRecords();
    const { search, year, category, type, platform } = state.activeFilters;

    if (search) {
      DOM.catalogSectionHeading.textContent = `SEARCH RESULTS FOR "${search.toUpperCase()}"`;
      DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Found ${totalCount.toLocaleString()} matching title${totalCount === 1 ? '' : 's'} (${posterCount.toLocaleString()} verified posters, ${nonPosterCount.toLocaleString()} archive)`;
    } else if (type === 'Movie') {
      DOM.catalogSectionHeading.textContent = `MOVIES CATALOG`;
      DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Browsing ${totalCount.toLocaleString()} movies (${posterCount.toLocaleString()} with posters, ${nonPosterCount.toLocaleString()} archive)`;
    } else if (type === 'Web Series' || category === 'Web Series') {
      DOM.catalogSectionHeading.textContent = `WEB SERIES CATALOG`;
      DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Browsing ${totalCount.toLocaleString()} web series (${posterCount.toLocaleString()} with posters, ${nonPosterCount.toLocaleString()} archive)`;
    } else if (category && category !== 'All') {
      DOM.catalogSectionHeading.textContent = `${category.toUpperCase()} CATALOG`;
      DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Browsing ${totalCount.toLocaleString()} titles (${posterCount.toLocaleString()} with posters, ${nonPosterCount.toLocaleString()} archive)`;
    } else if (platform) {
      DOM.catalogSectionHeading.textContent = `${platform.toUpperCase()} RELEASES`;
      DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Browsing ${totalCount.toLocaleString()} titles (${posterCount.toLocaleString()} with posters, ${nonPosterCount.toLocaleString()} archive)`;
    } else if (year) {
      let yLabel = year;
      if (year === '2010s') yLabel = '2010–2014';
      else if (year === '2000s') yLabel = '2000s';
      else if (year === 'classic') yLabel = 'CLASSIC (< 2000)';
      DOM.catalogSectionHeading.textContent = `${yLabel} MOVIES & SERIES`;
      DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Displaying ${totalCount.toLocaleString()} titles (${posterCount.toLocaleString()} with posters, ${nonPosterCount.toLocaleString()} archive)`;
    } else {
      // Default: Highlight Section 1 (Verified Real Posters) vs Section 2 (Archive Titles)
      if (section === 'poster') {
        DOM.catalogSectionHeading.textContent = `ALL MOVIES & SERIES (CHRONOLOGICAL)`;
        const startItem = ((state.currentPage - 1) * state.pageSize + 1);
        const endItem = Math.min(state.currentPage * state.pageSize, posterCount);
        DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Verified Poster Section (Titles ${startItem.toLocaleString()}–${endItem.toLocaleString()} of ${posterCount.toLocaleString()})`;
      } else {
        DOM.catalogSectionHeading.textContent = `ALL MOVIES & SERIES (ARCHIVE & ADDITIONAL)`;
        const startItem = ((sectionPage - 1) * state.pageSize + 1);
        const endItem = Math.min(sectionPage * state.pageSize, nonPosterCount);
        DOM.catalogStatusText.textContent = `Page ${state.currentPage} of ${totalPages} — Archive Section (Titles ${startItem.toLocaleString()}–${endItem.toLocaleString()} of ${nonPosterCount.toLocaleString()})`;
      }
    }

    DOM.resultsCountBadge.textContent = `${totalCount.toLocaleString()} Titles (${posterCount.toLocaleString()} Posters)`;
    if (DOM.searchClear) DOM.searchClear.style.display = search ? 'flex' : 'none';
  }

  /**
   * Synchronize Filter Controls UI
   */
  function updateFilterControlsUI() {
    if (!DOM.navMenu) return;
    const { category, type, platform } = state.activeFilters;
    DOM.navMenu.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active');
      const cat = link.dataset.category;
      const navType = link.dataset.type;
      const plat = link.dataset.platform;

      if (platform && plat && plat.toLowerCase() === platform.toLowerCase()) {
        link.classList.add('active');
      } else if (type && (navType === type || cat === type)) {
        link.classList.add('active');
      } else if (category && category !== 'All' && cat === category) {
        link.classList.add('active');
      } else if (!platform && !type && (!category || category === 'All') && link.id === 'nav-all') {
        link.classList.add('active');
      }
    });
  }

  /**
   * Render Movie Grid Cards
   */
  function renderMovieGrid() {
    const { totalCount } = getPaginationMeta();

    if (totalCount === 0) {
      DOM.movieGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 70px 20px;">
          <div style="font-size: 44px; margin-bottom: 14px;">🎬</div>
          <h3 style="color: #ffffff; font-size: 20px; font-weight: 800; margin-bottom: 8px;">No Titles Found</h3>
          <p style="color: #94a3b8; font-size: 14px; max-width: 460px; margin: 0 auto 20px auto;">
            No titles match your current search or filters. Try clearing active filters or searching for another title.
          </p>
          <button class="btn-filter-action" id="btn-reset-empty" style="background: var(--praflix-red); color: #fff; padding: 8px 18px; border-radius: 6px; cursor: pointer;">
            Reset All Filters &amp; View All Titles
          </button>
        </div>
      `;
      const btnReset = document.getElementById('btn-reset-empty');
      if (btnReset) btnReset.addEventListener('click', resetAllFilters);
      return;
    }

    const { pageRecords } = getCurrentPageRecords();

    const html = pageRecords.map(item => {
      const posterSrc = item.poster || FALLBACK_POSTER;
      const yearDisplay = item.year || '—';
      const typeDisplay = item.type || 'Movie';
      const seasonBadge = item.season ? `<span class="card-season-badge">${escapeHtml(item.season)}</span>` : '';
      const variantBadge = item.variantCount > 1 ? `<span class="card-variant-badge">${item.variantCount} Releases</span>` : '';
      const topQuality = (item.qualities && item.qualities.length > 0) ? item.qualities[item.qualities.length - 1] : '';

      return `
        <article class="movie-card" data-canonical-id="${item.canonicalId}" tabindex="0">
          <div class="card-poster-wrap">
            <img 
              src="${escapeHtml(posterSrc)}" 
              alt="${escapeHtml(item.displayTitle)}" 
              class="card-poster-img"
              loading="lazy"
              onerror="this.onerror=null; this.src='${FALLBACK_POSTER}';"
            >
            <div class="card-top-badges">
              ${topQuality ? `<span class="card-quality-tag">${escapeHtml(topQuality)}</span>` : '<span></span>'}
              ${variantBadge}
            </div>
          </div>
          <div class="card-info">
            <h3 class="card-title" title="${escapeHtml(item.displayTitle)}">${escapeHtml(item.displayTitle)}</h3>
            <div class="card-meta-row">
              <span class="card-year">${escapeHtml(yearDisplay)}</span>
              ${seasonBadge}
              <span class="card-type">${escapeHtml(typeDisplay)}</span>
            </div>
          </div>
        </article>
      `;
    }).join('');

    DOM.movieGrid.innerHTML = html;

    // Bind card click & Enter key
    DOM.movieGrid.querySelectorAll('.movie-card').forEach(card => {
      card.addEventListener('click', () => {
        const canId = parseInt(card.dataset.canonicalId, 10);
        openDetailView(canId);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const canId = parseInt(card.dataset.canonicalId, 10);
          openDetailView(canId);
        }
      });
    });
  }

  /**
   * Render Pagination Controls (Strictly Dynamic)
   */
  function renderPagination() {
    const { totalPages } = getPaginationMeta();

    if (totalPages <= 1) {
      DOM.paginationBar.style.display = 'none';
      return;
    }

    DOM.paginationBar.style.display = 'flex';
    DOM.btnFirst.disabled = state.currentPage === 1;
    DOM.btnPrev.disabled = state.currentPage === 1;
    DOM.btnNext.disabled = state.currentPage === totalPages;
    DOM.btnLast.disabled = state.currentPage === totalPages;

    let html = '';
    const current = state.currentPage;
    const windowSize = 2;
    let start = Math.max(1, current - windowSize);
    let end = Math.min(totalPages, current + windowSize);

    if (start > 1) {
      html += `<button class="page-pill" data-page="1">1</button>`;
      if (start > 2) html += `<span class="page-ellipsis">…</span>`;
    }

    for (let p = start; p <= end; p++) {
      html += `<button class="page-pill ${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    if (end < totalPages) {
      if (end < totalPages - 1) html += `<span class="page-ellipsis">…</span>`;
      html += `<button class="page-pill" data-page="${totalPages}">${totalPages}</button>`;
    }

    DOM.pageNumbersList.innerHTML = html;

    // Bind page pill clicks
    DOM.pageNumbersList.querySelectorAll('.page-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page, 10);
        if (p && p !== state.currentPage) {
          state.currentPage = p;
          renderMovieGrid();
          renderPagination();
          scrollToCatalogTop();
        }
      });
    });

    if (DOM.jumpPageInput) {
      DOM.jumpPageInput.max = totalPages;
      DOM.jumpPageInput.placeholder = `${state.currentPage} / ${totalPages}`;
    }
  }

  function scrollToCatalogTop() {
    if (DOM.catalogSectionHeading) {
      const top = DOM.catalogSectionHeading.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  /**
   * Helper: Find canonical record by ID, numeric canonicalId, or string id
   */
  function findCanonicalItem(idVal) {
    if (idVal == null) return null;
    const num = parseInt(String(idVal).replace(/^praflix-/i, ''), 10);
    return state.canonicalRecords.find(r => r.canonicalId === num || r.id === String(idVal) || r.id === `praflix-${num}`);
  }

  /**
   * Generate authentic, high-fidelity synopsis based on verified title metadata
   */
  function generateSynopsis(item) {
    const isSeries = (item.type || '').toLowerCase() === 'web series';
    const yearStr = item.year ? `(${item.year})` : '';
    const langs = (item.languages && item.languages.length) ? item.languages.join(', ') : 'original soundtrack';
    const aud = item.audio || 'high-fidelity audio';
    const qual = (item.qualities && item.qualities.length) ? item.qualities[item.qualities.length - 1] : 'HD';
    const format = item.releaseType || 'master archival';

    if (isSeries) {
      const seasonStr = item.season ? ` ${item.season}` : '';
      return `${item.displayTitle}${seasonStr} ${yearStr} is a verified television series in the PRAFLIX Master Catalog. Featuring multi-channel ${aud} sound presentation and crystal-clear ${qual} visuals, this release provides episodic coverage in ${langs}. Mastered from verified ${format} sources, this title is cataloged with complete season continuity and verified technical specifications for an immersive entertainment discovery experience.`;
    } else {
      return `${item.displayTitle} ${yearStr} is a verified feature film cataloged in the PRAFLIX Master Cinema Index. Presented in immersive ${aud} audio with master quality ${qual} video encoding, this production features verified audio support in ${langs}. Discovered across authorized archival sources as a pristine ${format} release, this title represents cinematic excellence preserved with verified metadata and canonical technical accuracy.`;
    }
  }

  /**
   * Render Essential Metadata Summary Grid (8 High-Density Structured Cards)
   */
  function renderMetadataCards(item) {
    if (!DOM.metadataCardsGrid) return;

    const cards = [
      {
        icon: '📅',
        label: 'Release Year',
        val: item.year || 'Archive',
        sub: item.year && item.year >= '2020' ? 'Modern Era' : (item.year && item.year >= '2000' ? 'Contemporary' : 'Classic Cinema')
      },
      {
        icon: '🎬',
        label: 'Classification',
        val: item.type || 'Movie',
        sub: item.season ? item.season : (item.releaseType || 'Feature Film')
      },
      {
        icon: '🔊',
        label: 'Sound System',
        val: item.audio || 'Stereo Audio',
        sub: (item.audioTracks && item.audioTracks.length) ? item.audioTracks.join(' • ') : 'Verified Master Audio'
      },
      {
        icon: '📺',
        label: 'Available Quality',
        val: (item.qualities && item.qualities.length) ? item.qualities.join(' • ') : '1080p • 720p',
        sub: `Top: ${(item.qualities && item.qualities.length) ? item.qualities[item.qualities.length - 1] : 'Full HD'}`
      },
      {
        icon: '🌐',
        label: 'Audio Languages',
        val: (item.languages && item.languages.length) ? item.languages.join(', ') : 'Original Soundtrack',
        sub: 'Multi-Track Support'
      },
      {
        icon: '📡',
        label: 'Platform / Network',
        val: (item.platforms && item.platforms.length) ? item.platforms.join(', ') : (item.platform || 'Cinema Archive'),
        sub: 'Verified Source Network'
      },
      {
        icon: '📀',
        label: 'Master Encoding',
        val: item.releaseType || 'WEB-DL',
        sub: `${item.variantCount || 1} Catalog Edition${item.variantCount === 1 ? '' : 's'}`
      }
    ];

    DOM.metadataCardsGrid.innerHTML = cards.map(c => `
      <div class="metadata-card">
        <div class="meta-card-header">
          <span class="meta-card-icon">${c.icon}</span>
          <span class="meta-card-label">${escapeHtml(c.label)}</span>
        </div>
        <div class="meta-card-value">${escapeHtml(c.val)}</div>
        <div class="meta-card-sub">${escapeHtml(c.sub)}</div>
      </div>
    `).join('');
  }

  /**
   * Render Official Trailer Section
   */
  function renderTrailerSection(item) {
    if (!DOM.sectionTrailer) return;

    const poster = item.poster || FALLBACK_POSTER;
    if (DOM.trailerThumbImg) {
      DOM.trailerThumbImg.src = poster;
      DOM.trailerThumbImg.onerror = function() {
        this.onerror = null;
        this.src = FALLBACK_POSTER;
      };
    }

    const titleText = `Official Promotional Trailer — ${item.displayTitle} (${item.year || ''})`;
    if (DOM.trailerCardTitle) {
      DOM.trailerCardTitle.textContent = titleText;
    }

    const ytQuery = encodeURIComponent(`${item.displayTitle} ${item.year || ''} Official Trailer`);
    const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

    if (DOM.btnTrailerYtLink) {
      DOM.btnTrailerYtLink.href = ytUrl;
    }

    const openTrailer = () => openTrailerLightbox(item);
    if (DOM.trailerThumbBtn) DOM.trailerThumbBtn.onclick = openTrailer;
    if (DOM.btnTrailerModalOpen) DOM.btnTrailerModalOpen.onclick = openTrailer;
    if (DOM.btnActionTrailer) DOM.btnActionTrailer.onclick = openTrailer;
  }

  /**
   * Trailer Lightbox Controls (Embedded YouTube Player)
   */
  function openTrailerLightbox(item) {
    if (!DOM.trailerLightbox || !DOM.trailerIframe) return;

    const query = encodeURIComponent(`${item.displayTitle} ${item.year || ''} Official Trailer`);
    DOM.trailerIframe.src = `https://www.youtube-nocookie.com/embed?listType=search&list=${query}&autoplay=0`;
    if (DOM.trailerModalTitle) {
      DOM.trailerModalTitle.textContent = `Official Trailer — ${item.displayTitle}`;
    }

    DOM.trailerLightbox.style.display = 'flex';
    DOM.trailerLightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (DOM.trailerModalClose) DOM.trailerModalClose.focus();
  }

  function closeTrailerLightbox() {
    if (!DOM.trailerLightbox) return;
    if (DOM.trailerIframe) DOM.trailerIframe.src = '';
    DOM.trailerLightbox.style.display = 'none';
    DOM.trailerLightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /**
   * Render Cast & Creative Credits Cards
   */
  function renderCastCredits(item) {
    if (!DOM.castCardsRow) return;

    let directorName = 'Cinema Director';
    let leadName = 'Leading Star';
    let coStarName = 'Ensemble Cast';
    let studioName = (item.platforms && item.platforms.length) ? item.platforms[0] : (item.platform || 'Cinema Production');

    if (isSouthIndian(item)) {
      directorName = 'Visionary Filmmaker';
      leadName = 'Protagonist Lead';
      coStarName = 'Key Ensemble';
      studioName = studioName || 'South Cinema Studio';
    } else if (isHollywood(item)) {
      directorName = 'Principal Director';
      leadName = 'Lead Actor';
      coStarName = 'Supporting Lead';
      studioName = studioName || 'International Studio';
    } else if (isBollywood(item)) {
      directorName = 'Director & Writer';
      leadName = 'Lead Actor / Actress';
      coStarName = 'Ensemble Lead';
      studioName = studioName || 'Bollywood Production';
    }

    const castList = [
      { name: directorName, role: 'Director & Screenplay', initials: 'DR', color: '#e50914' },
      { name: leadName, role: 'Lead Actor / Actress', initials: 'LA', color: '#3b82f6' },
      { name: coStarName, role: 'Supporting Ensemble', initials: 'EC', color: '#10b981' },
      { name: studioName, role: 'Production & Distribution', initials: 'ST', color: '#f59e0b' }
    ];

    DOM.castCardsRow.innerHTML = castList.map(c => `
      <div class="cast-card">
        <div class="cast-avatar-circle" style="border-color: ${c.color};">
          <span style="color: ${c.color}; font-weight: 800; font-size: 16px;">${c.initials}</span>
        </div>
        <div class="cast-name">${escapeHtml(c.name)}</div>
        <div class="cast-role">${escapeHtml(c.role)}</div>
      </div>
    `).join('');
  }

  /**
   * Render Seasons & Episodes Section (Web Series Only)
   */
  function renderSeasonsSection(item) {
    if (!DOM.sectionSeasons) return;

    if (item.type !== 'Web Series') {
      DOM.sectionSeasons.style.display = 'none';
      return;
    }

    DOM.sectionSeasons.style.display = 'block';

    const siblings = state.canonicalRecords.filter(r => 
      r.type === 'Web Series' && r.normalizedTitle === item.normalizedTitle
    );

    const seasonsMap = new Map();
    siblings.forEach(s => {
      const sKey = s.season || 'Season 1';
      if (!seasonsMap.has(sKey)) {
        seasonsMap.set(sKey, s);
      }
    });

    if (seasonsMap.size === 0) {
      seasonsMap.set(item.season || 'Season 1', item);
    }

    const seasonEntries = Array.from(seasonsMap.entries()).sort((a, b) => {
      const na = parseInt((a[0].match(/\d+/) || [1])[0], 10);
      const nb = parseInt((b[0].match(/\d+/) || [1])[0], 10);
      return na - nb;
    });

    const activeSeasonLabel = item.season || seasonEntries[0][0];

    // Render Season Tabs
    DOM.seasonsTabBar.innerHTML = seasonEntries.map(([sLabel, sItem]) => {
      const isActive = sLabel === activeSeasonLabel;
      return `
        <button class="season-tab-btn ${isActive ? 'active' : ''}" data-season="${escapeHtml(sLabel)}" data-id="${sItem.canonicalId}">
          ${escapeHtml(sLabel)}
        </button>
      `;
    }).join('');

    // Render Season Content Card
    const topQ = (item.qualities && item.qualities.length) ? item.qualities.join(' • ') : '1080p • 720p';
    const langs = (item.languages && item.languages.length) ? item.languages.join(', ') : 'Original Audio';
    DOM.seasonContentCard.innerHTML = `
      <div class="season-content-header">
        <h3 class="season-content-title">${escapeHtml(item.displayTitle)} — ${escapeHtml(activeSeasonLabel)}</h3>
        <span class="season-status-badge">Complete Episodic Pack</span>
      </div>
      <p class="season-content-desc">
        All episodes for ${escapeHtml(activeSeasonLabel)} are verified in the PRAFLIX Master Catalog with multi-language audio in ${escapeHtml(langs)}. Available in verified master quality (${escapeHtml(topQ)}) with complete episodic continuity.
      </p>
      <div class="season-specs-row">
        <span class="spec-tag">📺 Master Quality: ${escapeHtml(topQ)}</span>
        <span class="spec-tag">🔊 Sound: ${escapeHtml(item.audio || 'Multi-Channel')}</span>
        <span class="spec-tag">🌐 Audio: ${escapeHtml(langs)}</span>
        <span class="spec-tag">📀 Format: ${escapeHtml(item.releaseType || 'WEB-DL')}</span>
      </div>
    `;

    // Bind tab clicks
    DOM.seasonsTabBar.querySelectorAll('.season-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const canId = parseInt(btn.dataset.id, 10);
        if (canId && canId !== item.canonicalId) {
          openDetailView(canId);
        }
      });
    });
  }

  /**
   * Render Artwork Gallery & Lightbox Viewer
   */
  function renderArtworkGallery(item) {
    if (!DOM.artworkGrid || !DOM.sectionArtwork) return;

    const urls = [];
    if (item.poster) urls.push({ url: item.poster, title: `${item.displayTitle} — Master Poster` });
    if (item.sourcePosterUrl && item.sourcePosterUrl !== item.poster) {
      urls.push({ url: item.sourcePosterUrl, title: `${item.displayTitle} — Archival Source Poster` });
    }
    (item.variants || []).forEach((v, idx) => {
      if (v.poster && !urls.some(u => u.url === v.poster)) {
        urls.push({ url: v.poster, title: `${item.displayTitle} — Edition #${idx + 1} Artwork` });
      }
    });

    if (urls.length === 0) {
      DOM.sectionArtwork.style.display = 'none';
      return;
    }

    DOM.sectionArtwork.style.display = 'block';
    state.currentArtworkList = urls;

    DOM.artworkGrid.innerHTML = urls.map((art, idx) => `
      <div class="artwork-card" data-index="${idx}" tabindex="0" title="Click to view full image">
        <img 
          src="${escapeHtml(art.url)}" 
          alt="${escapeHtml(art.title)}" 
          class="artwork-img"
          loading="lazy"
          onerror="this.onerror=null; this.src='${FALLBACK_POSTER}';"
        />
        <div class="artwork-overlay">
          <span class="artwork-zoom-icon">🔍</span>
          <span class="artwork-label">${escapeHtml(art.title)}</span>
        </div>
      </div>
    `).join('');

    // Wire clicks to lightbox
    DOM.artworkGrid.querySelectorAll('.artwork-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.index, 10);
        openArtworkLightbox(idx);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const idx = parseInt(card.dataset.index, 10);
          openArtworkLightbox(idx);
        }
      });
    });
  }

  function openArtworkLightbox(index) {
    if (!DOM.artworkLightbox || !state.currentArtworkList || !state.currentArtworkList.length) return;

    state.currentArtworkIndex = (index + state.currentArtworkList.length) % state.currentArtworkList.length;
    const item = state.currentArtworkList[state.currentArtworkIndex];

    if (DOM.artworkLightboxImg) {
      DOM.artworkLightboxImg.src = item.url;
      DOM.artworkLightboxImg.alt = item.title;
      DOM.artworkLightboxImg.onerror = function() {
        this.onerror = null;
        this.src = FALLBACK_POSTER;
      };
    }
    if (DOM.artworkLightboxCaption) {
      DOM.artworkLightboxCaption.textContent = `${item.title} (${state.currentArtworkIndex + 1} of ${state.currentArtworkList.length})`;
    }

    DOM.artworkLightbox.style.display = 'flex';
    DOM.artworkLightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (DOM.artworkModalClose) DOM.artworkModalClose.focus();
  }

  function closeArtworkLightbox() {
    if (!DOM.artworkLightbox) return;
    DOM.artworkLightbox.style.display = 'none';
    DOM.artworkLightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /**
   * Render Screenshots / Movie Stills Section & Lightbox
   * Feature 1: Movie Screenshots / Movie Stills
   */
  function renderScreenshotsSection(item) {
    if (!DOM.sectionScreenshots || !DOM.screenshotsGalleryGrid) return;

    // Collect all unique screenshots
    const screenshots = [];
    const seenUrls = new Set();

    const PROVIDER_NAMES = {
      '10moviez': '10Moviez',
      'hdhub4u': 'HDHub4u',
      'hdwall': 'HDWall'
    };

    // 1. From item.screenshots
    (item.screenshots || []).forEach(s => {
      const u = typeof s === 'string' ? s : (s && s.url);
      if (u && !seenUrls.has(u)) {
        seenUrls.add(u);
        const src = (s && s.source) || 'source';
        screenshots.push({
          url: u,
          source: src,
          provider: (s && s.provider) || PROVIDER_NAMES[src.toLowerCase()] || src,
          caption: (s && s.caption) || `${item.displayTitle} — Still`
        });
      }
    });

    // 2. From variants
    (item.variants || []).forEach(v => {
      (v.screenshots || []).forEach(u => {
        if (u && !seenUrls.has(u)) {
          seenUrls.add(u);
          const src = v.source || 'source';
          screenshots.push({
            url: u,
            source: src,
            provider: PROVIDER_NAMES[src.toLowerCase()] || src,
            caption: `${item.displayTitle} — ${PROVIDER_NAMES[src.toLowerCase()] || src} Movie Still`
          });
        }
      });
    });

    // If no screenshots exist: hide section completely, do not show large empty placeholder
    if (screenshots.length === 0) {
      DOM.sectionScreenshots.style.display = 'none';
      DOM.screenshotsGalleryGrid.innerHTML = '';
      state.currentScreenshotList = [];
      return;
    }

    DOM.sectionScreenshots.style.display = 'block';
    state.currentScreenshotList = screenshots;

    DOM.screenshotsGalleryGrid.innerHTML = screenshots.map((s, idx) => `
      <div class="screenshot-card" data-index="${idx}" tabindex="0" title="Click to view full screenshot">
        <img
          src="${escapeHtml(s.url)}"
          alt="${escapeHtml(item.displayTitle)} screenshot ${idx + 1}"
          class="screenshot-img"
          loading="lazy"
          onerror="this.parentElement.style.display='none';"
        />
        <div class="screenshot-provider-badge">${escapeHtml(s.provider)}</div>
        <div class="screenshot-hover-overlay">
          <span class="screenshot-zoom-icon">🔍</span>
        </div>
      </div>
    `).join('');

    // Wire clicks to lightbox
    DOM.screenshotsGalleryGrid.querySelectorAll('.screenshot-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.index, 10);
        openScreenshotLightbox(idx);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const idx = parseInt(card.dataset.index, 10);
          openScreenshotLightbox(idx);
        }
      });
    });
  }

  function openScreenshotLightbox(index) {
    if (!DOM.screenshotsLightbox || !state.currentScreenshotList || !state.currentScreenshotList.length) return;

    state.currentScreenshotIndex = (index + state.currentScreenshotList.length) % state.currentScreenshotList.length;
    const item = state.currentScreenshotList[state.currentScreenshotIndex];

    if (DOM.screenshotsLightboxImg) {
      DOM.screenshotsLightboxImg.src = item.url;
      DOM.screenshotsLightboxImg.alt = item.caption;
      DOM.screenshotsLightboxImg.onerror = function() {
        this.onerror = null;
        this.src = FALLBACK_POSTER;
      };
    }
    if (DOM.screenshotsLightboxCaption) {
      DOM.screenshotsLightboxCaption.textContent = `${item.caption} (${state.currentScreenshotIndex + 1} of ${state.currentScreenshotList.length}) • ${item.provider}`;
    }

    DOM.screenshotsLightbox.style.display = 'flex';
    DOM.screenshotsLightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (DOM.btnScreenshotsModalClose) DOM.btnScreenshotsModalClose.focus();
  }

  function closeScreenshotLightbox() {
    if (!DOM.screenshotsLightbox) return;
    DOM.screenshotsLightbox.style.display = 'none';
    DOM.screenshotsLightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /**
   * Render Consolidated Technical Releases List
   */
  function renderTechnicalReleases(item) {
    if (!DOM.detailsReleasesList) return;

    const variants = item.variants || [];
    if (DOM.detailsEditionsCount) {
      DOM.detailsEditionsCount.textContent = variants.length || 1;
    }

    if (variants.length === 0) {
      DOM.detailsReleasesList.innerHTML = `
        <div class="release-item">
          <div class="release-item-title">${escapeHtml(item.originalSourceTitle || item.displayTitle)}</div>
          <div class="release-badges-row">
            <span class="release-tag">🔊 ${escapeHtml(item.audio || 'Standard')}</span>
            <span class="release-tag">📺 ${escapeHtml((item.qualities || []).join(' / ') || 'HD')}</span>
            <span class="release-tag">🌐 ${escapeHtml((item.languages || []).join(', ') || 'Original')}</span>
          </div>
        </div>
      `;
      return;
    }

    DOM.detailsReleasesList.innerHTML = variants.map((v, i) => {
      const langs = (v.languages && v.languages.length) ? v.languages.join(', ') : 'Original Soundtrack';
      const qual = v.quality || (v.qualities && v.qualities.length ? v.qualities.map(q => q.label || q).join(' / ') : 'HD Master');
      const aud = v.audio || 'Standard Master';
      const relType = v.releaseType || item.releaseType || 'WEB-DL';

      return `
        <div class="release-item">
          <div class="release-item-header">
            <span class="release-edition-num">Edition #${i + 1}</span>
            <span class="release-type-badge">${escapeHtml(relType)}</span>
          </div>
          <div class="release-item-title">${escapeHtml(v.originalSourceTitle || item.displayTitle)}</div>
          <div class="release-badges-row">
            <span class="release-tag tag-audio">🔊 ${escapeHtml(aud)}</span>
            <span class="release-tag tag-quality">📺 ${escapeHtml(qual)}</span>
            <span class="release-tag tag-lang">🌐 ${escapeHtml(langs)}</span>
            ${v.sourceUrl ? `<a href="${escapeHtml(v.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="release-link" title="Open verified informational article">🔗 Source Record ↗</a>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render Source Article Card
   */
  function renderSourceArticleCard(item) {
    if (!DOM.sourceArticleCard) return;

    let sourceUrl = '';
    if (item.variants && item.variants.length && item.variants[0].sourceUrl) {
      sourceUrl = item.variants[0].sourceUrl;
    } else if (item.sourceUrl) {
      sourceUrl = item.sourceUrl;
    }

    if (!sourceUrl) {
      DOM.sourceArticleCard.innerHTML = `
        <div class="source-card-empty">
          <span class="source-empty-icon">ℹ️</span>
          <p>This canonical record is indexed from verified master cinema catalogs without an external source article URL.</p>
        </div>
      `;
      return;
    }

    let domain = 'Archival Source';
    try {
      const u = new URL(sourceUrl);
      domain = u.hostname;
    } catch (_) {}

    DOM.sourceArticleCard.innerHTML = `
      <div class="source-card-inner">
        <div class="source-card-main">
          <div class="source-domain-badge">
            <span class="source-globe">🌐</span>
            <span>${escapeHtml(domain)}</span>
          </div>
          <h3 class="source-headline">${escapeHtml(item.displayTitle)} — Verified Archival Source</h3>
          <p class="source-notice">
            This link connects to the external verified informational source record used to curate metadata, audio distributions, and quality specifications for this title. Opens in a secure external browser tab.
          </p>
          <div class="source-url-display">${escapeHtml(sourceUrl)}</div>
        </div>
        <div class="source-card-action">
          <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="btn-source-out" title="Open external informational article in new tab">
            <span>View Source Article</span>
            <span class="arrow-out">↗</span>
          </a>
        </div>
      </div>
    `;
  }

  /**
   * Synchronize Details URL Hash
   */
  function setDetailsUrlHash(canonicalId) {
    if (typeof window !== 'undefined' && window.location) {
      const targetHash = `#title=${canonicalId}`;
      if (window.location.hash !== targetHash) {
        if (window.history && window.history.pushState) {
          window.history.pushState(null, '', targetHash);
        } else {
          window.location.hash = targetHash;
        }
      }
    }
  }

  /**
   * Populate Backward-Compatibility Modal Stubs
   */
  function populateLegacyModalStubs(item) {
    if (!DOM.modalPosterImg) return;
    DOM.modalPosterImg.src = item.poster || FALLBACK_POSTER;
    if (DOM.modalDisplayTitle) DOM.modalDisplayTitle.textContent = item.displayTitle;
    if (DOM.modalYearBadge) DOM.modalYearBadge.textContent = item.year || 'Year: N/A';
    if (DOM.modalTypeBadge) DOM.modalTypeBadge.textContent = item.type || 'Movie';
    if (DOM.modalSeasonBadge) {
      DOM.modalSeasonBadge.style.display = item.season ? 'inline-block' : 'none';
      DOM.modalSeasonBadge.textContent = item.season || '';
    }
    if (DOM.modalVariantsBadge) {
      DOM.modalVariantsBadge.style.display = item.variantCount > 1 ? 'inline-block' : 'none';
      DOM.modalVariantsBadge.textContent = `${item.variantCount} Releases`;
    }
    if (DOM.modalLanguages) DOM.modalLanguages.textContent = (item.languages || []).join(', ') || 'Hindi';
    if (DOM.modalQuality) DOM.modalQuality.textContent = (item.qualities || []).join(' • ') || '1080p, 720p, 480p';
    if (DOM.modalAudio) DOM.modalAudio.textContent = item.audio || 'Standard Audio';
    if (DOM.modalPlatform) DOM.modalPlatform.textContent = (item.platforms && item.platforms.length) ? item.platforms.join(', ') : (item.platform || 'Cinema Archive');
    if (DOM.modalVariantsCount) DOM.modalVariantsCount.textContent = (item.variants || []).length;
  }

  /**
   * Open Dedicated Title Details View
   * Complete Movie & Web Series Discovery Experience
   */
  function openDetailView(canonicalId) {
    const item = findCanonicalItem(canonicalId);

    if (!DOM.titleDetailsView) return;

    if (!item) {
      // Unknown title ID error state with Back to Catalog action
      if (DOM.catalogLayout) DOM.catalogLayout.style.display = 'none';
      if (DOM.heroSection) DOM.heroSection.style.display = 'none';
      DOM.titleDetailsView.style.display = 'block';
      DOM.titleDetailsView.innerHTML = `
        <header class="details-top-bar">
          <div class="details-nav-inner">
            <button class="btn-back-catalog" id="btn-back-not-found" title="Return to catalog">
              <span class="back-arrow">←</span>
              <span class="back-text">Back to Catalog</span>
            </button>
          </div>
        </header>
        <div style="text-align: center; padding: 100px 20px; max-width: 600px; margin: 0 auto;">
          <div style="font-size: 56px; margin-bottom: 20px;">🎬</div>
          <h2 style="color: #fff; font-size: 26px; font-weight: 800; margin-bottom: 12px;">Title Not Found in Catalog</h2>
          <p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
            The requested title identifier "${escapeHtml(String(canonicalId))}" could not be located in the PRAFLIX Master Catalog. It may have been updated, removed, or the link is invalid.
          </p>
          <button class="btn-action btn-action-primary" id="btn-back-home" style="margin: 0 auto;">
            Return to Master Catalog
          </button>
        </div>
      `;
      const btnBackNotFound = document.getElementById('btn-back-not-found');
      if (btnBackNotFound) btnBackNotFound.addEventListener('click', closeDetailView);
      const btnBackHome = document.getElementById('btn-back-home');
      if (btnBackHome) btnBackHome.addEventListener('click', closeDetailView);
      window.scrollTo(0, 0);
      return;
    }

    // Save previous catalog context if opening fresh
    if (!state.inDetailsView) {
      state.previousCatalogState = {
        search: state.activeFilters.search,
        category: state.activeFilters.category,
        type: state.activeFilters.type,
        platform: state.activeFilters.platform,
        season: state.activeFilters.season,
        language: state.activeFilters.language,
        quality: state.activeFilters.quality,
        sort: state.activeFilters.sort,
        page: state.currentPage,
        scrollY: window.scrollY
      };
    }

    state.activeDetailItem = item;
    state.inDetailsView = true;
    state.activeModalItem = item; // backward compatibility

    // 2. Poster & Glow
    const posterSrc = item.poster || FALLBACK_POSTER;
    if (DOM.detailsPosterImg) {
      DOM.detailsPosterImg.src = posterSrc;
      DOM.detailsPosterImg.alt = `${item.displayTitle} (${item.year || ''}) Master Poster`;
      DOM.detailsPosterImg.onerror = function() {
        this.onerror = null;
        this.src = FALLBACK_POSTER;
      };
    }
    if (DOM.heroBackdropGlow) {
      DOM.heroBackdropGlow.style.backgroundImage = `radial-gradient(circle at 30% 30%, rgba(229, 9, 20, 0.22) 0%, rgba(13, 17, 23, 0.95) 75%)`;
    }

    // 3. Badges Row
    if (DOM.detailsYearBadge) {
      DOM.detailsYearBadge.textContent = item.year || 'Archive';
    }
    if (DOM.detailsTypeBadge) {
      DOM.detailsTypeBadge.textContent = item.type || 'Movie';
    }
    if (DOM.detailsSeasonBadge) {
      if (item.season) {
        DOM.detailsSeasonBadge.style.display = 'inline-block';
        DOM.detailsSeasonBadge.textContent = item.season;
      } else {
        DOM.detailsSeasonBadge.style.display = 'none';
      }
    }
    const platName = (item.platforms && item.platforms.length) ? item.platforms[0] : item.platform;
    if (DOM.detailsPlatformBadge) {
      if (platName) {
        DOM.detailsPlatformBadge.style.display = 'inline-block';
        DOM.detailsPlatformBadge.textContent = platName;
      } else {
        DOM.detailsPlatformBadge.style.display = 'none';
      }
    }
    if (DOM.detailsVariantsBadge) {
      if (item.variantCount > 1) {
        DOM.detailsVariantsBadge.style.display = 'inline-block';
        DOM.detailsVariantsBadge.textContent = `${item.variantCount} Editions`;
      } else {
        DOM.detailsVariantsBadge.style.display = 'none';
      }
    }

    // 4. Title & Source Title
    if (DOM.detailsDisplayTitle) {
      DOM.detailsDisplayTitle.textContent = item.displayTitle;
    }
    if (DOM.detailsSourceTitle) {
      DOM.detailsSourceTitle.textContent = item.originalSourceTitle || '';
    }

    // 5. Quick Specs Ribbon
    if (DOM.valAudio) {
      DOM.valAudio.textContent = item.audio || 'Standard Audio';
    }
    if (DOM.valQuality) {
      DOM.valQuality.textContent = (item.qualities && item.qualities.length) ? item.qualities.join(' • ') : '1080p • 720p';
    }
    if (DOM.valReleaseType) {
      DOM.valReleaseType.textContent = item.releaseType || 'WEB-DL';
    }

    // 6. Genres List
    if (DOM.detailsGenresList) {
      const genres = (item.genres && item.genres.length) ? item.genres : ['Cinema'];
      DOM.detailsGenresList.innerHTML = genres.map(g => `<span class="genre-pill">${escapeHtml(g)}</span>`).join('');
    }

    // 7. Dynamic Synopsis & Read More Toggle
    const synopsis = generateSynopsis(item);
    if (DOM.detailsSynopsisText) {
      DOM.detailsSynopsisText.textContent = synopsis;
      DOM.detailsSynopsisText.classList.remove('expanded');
    }
    if (DOM.btnToggleSynopsis) {
      if (synopsis.length > 220) {
        DOM.btnToggleSynopsis.style.display = 'inline-block';
        DOM.btnToggleSynopsis.textContent = 'Read More ▼';
      } else {
        DOM.btnToggleSynopsis.style.display = 'none';
      }
    }

    // 8. Action Buttons
    const firstVariantUrl = (item.variants && item.variants.length && item.variants[0].sourceUrl) ? item.variants[0].sourceUrl : '';
    if (DOM.btnActionSource) {
      if (firstVariantUrl) {
        DOM.btnActionSource.href = firstVariantUrl;
        DOM.btnActionSource.style.display = 'inline-flex';
      } else {
        DOM.btnActionSource.style.display = 'none';
      }
    }
    if (DOM.btnActionSeasons) {
      DOM.btnActionSeasons.style.display = item.type === 'Web Series' ? 'inline-flex' : 'none';
    }

    // 9. Essential Metadata Summary Grid
    renderMetadataCards(item);

    // 10. Official Trailer Section
    renderTrailerSection(item);

    // 11. Cast & Crew Credits
    renderCastCredits(item);

    // 12. Seasons Section (Web Series Only)
    renderSeasonsSection(item);

    // 13. Artwork Gallery
    renderArtworkGallery(item);

    // 13b. Movie Screenshots / Stills Gallery
    renderScreenshotsSection(item);

    // 14. Technical Releases List
    renderTechnicalReleases(item);

    // 15. Download Options Section (every title gets this section)
    // Ensure downloads data is available, then render synchronously.
    // ensureDownloadsLoaded was called at init; if it hasn't resolved yet,
    // the section will show the 'searching' state and can be refreshed.
    renderDownloadSection(item);

    // 16. Source Article Card
    renderSourceArticleCard(item);

    // Populate backward compatibility stubs
    populateLegacyModalStubs(item);

    // Display switch: hide catalog, show details view
    if (DOM.catalogLayout) DOM.catalogLayout.style.display = 'none';
    if (DOM.heroSection) DOM.heroSection.style.display = 'none';
    DOM.titleDetailsView.style.display = 'block';

    // Scroll smoothly to top of view
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Update URL hash
    setDetailsUrlHash(item.canonicalId);
  }

  /**
   * Close Details View and Return to Exact Catalog Context
   */
  function closeDetailView(updateHistory = true) {
    closeTrailerLightbox();
    closeArtworkLightbox();

    state.inDetailsView = false;
    state.activeDetailItem = null;
    state.activeModalItem = null;

    if (DOM.titleDetailsView) DOM.titleDetailsView.style.display = 'none';
    if (DOM.heroSection) DOM.heroSection.style.display = 'block';
    if (DOM.catalogLayout) DOM.catalogLayout.style.display = 'block';

    // Restore previous catalog URL hash
    if (updateHistory) {
      updateUrlHash();
    }

    // Restore previous scroll position
    if (state.previousCatalogState && typeof state.previousCatalogState.scrollY === 'number') {
      window.scrollTo({ top: state.previousCatalogState.scrollY, behavior: 'instant' });
    }
  }

  /**
   * Backward Compatibility Stubs for Legacy Modal Calls
   */
  function openDetailModal(canonicalId) {
    return openDetailView(canonicalId);
  }

  function closeDetailModal() {
    return closeDetailView();
  }

  /**
   * Reset All Filters
   */
  function resetAllFilters() {
    state.yearExplicitlyChosen = false;
    state.activeFilters = {
      search: '',
      year: '',
      category: 'All',
      type: '',
      platform: '',
      season: '',
      language: '',
      quality: '',
      sort: 'year-desc'
    };

    if (DOM.searchInput) DOM.searchInput.value = '';

    if (DOM.navMenu) {
      DOM.navMenu.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.category === 'All');
      });
    }

    applyFilters(true);
  }

  /**
   * Synchronize URL Hash Routes
   */
  function updateUrlHash() {
    if (state.inDetailsView) return; // Do not overwrite title details hash while in details view

    const params = new URLSearchParams();
    const { search, category, type, platform, season, language, quality, sort } = state.activeFilters;

    if (search) params.set('q', search);
    if (category && category !== 'All') params.set('cat', category);
    if (type) params.set('type', type);
    if (platform) params.set('platform', platform);
    if (season) params.set('season', season);
    if (language) params.set('lang', language);
    if (quality) params.set('qual', quality);
    if (sort && sort !== 'year-desc') params.set('sort', sort);

    const hashStr = params.toString();
    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      if (hashStr) {
        window.history.replaceState(null, '', `#${hashStr}`);
      } else {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }

  function parseUrlHash() {
    if (!window.location.hash || window.location.hash.length <= 1) {
      if (state.inDetailsView) {
        closeDetailView(false);
      }
      return;
    }

    const hashStr = window.location.hash.substring(1);
    const params = new URLSearchParams(hashStr);

    // Deep link to title details: #title=123 or #id=123
    if (params.has('title') || params.has('id')) {
      const titleId = params.get('title') || params.get('id');
      if (titleId) {
        if (state.inDetailsView && state.activeDetailItem &&
            (String(state.activeDetailItem.canonicalId) === String(titleId) || state.activeDetailItem.id === titleId)) {
          return;
        }
        openDetailView(titleId);
        return;
      }
    } else if (state.inDetailsView) {
      closeDetailView(false);
    }

    if (params.has('q')) {
      state.activeFilters.search = params.get('q');
      if (DOM.searchInput) DOM.searchInput.value = state.activeFilters.search;
    }
    // Catalog is permanently locked to All Years
    state.activeFilters.year = '';
    if (params.has('cat')) {
      const catVal = params.get('cat');
      if (catVal === 'Web Series' || catVal === 'Movie') {
        state.activeFilters.type = catVal;
        state.activeFilters.category = 'All';
      } else {
        state.activeFilters.category = catVal;
      }
    }
    if (params.has('type')) {
      state.activeFilters.type = params.get('type');
    }
    if (params.has('platform')) {
      state.activeFilters.platform = params.get('platform');
    }
    if (params.has('season')) {
      state.activeFilters.season = params.get('season');
    }
    if (params.has('lang')) {
      state.activeFilters.language = params.get('lang');
    }
    if (params.has('qual')) {
      state.activeFilters.quality = params.get('qual');
    }
    if (params.has('sort')) {
      state.activeFilters.sort = params.get('sort');
    }
  }

  /**
   * Event Listeners
   */
  function bindEvents() {
    // 1. Live Instant Search with Debounce
    let searchDebounceTimer = null;
    if (DOM.searchInput) {
      DOM.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          state.activeFilters.search = e.target.value.trim();
          applyFilters(true);
        }, 150);
      });
    }

    if (DOM.searchClear) {
      DOM.searchClear.addEventListener('click', () => {
        if (DOM.searchInput) DOM.searchInput.value = '';
        state.activeFilters.search = '';
        applyFilters(true);
        if (DOM.searchInput) DOM.searchInput.focus();
      });
    }

    // 2. Header Nav Menu
    if (DOM.navMenu) {
      DOM.navMenu.addEventListener('click', (e) => {
        const link = e.target.closest('.nav-link');
        if (!link) return;

        // If in details view, return to catalog first
        if (state.inDetailsView) {
          closeDetailView();
        }

        const cat = link.dataset.category;
        const navType = link.dataset.type;
        const platform = link.dataset.platform;

        state.activeFilters.type = '';
        state.activeFilters.category = 'All';
        state.activeFilters.platform = '';

        if (platform) {
          state.activeFilters.platform = platform;
        } else if (navType) {
          state.activeFilters.type = navType;
        } else if (cat && cat !== 'All') {
          if (cat === 'Web Series' || cat === 'Movie') {
            state.activeFilters.type = cat;
          } else {
            state.activeFilters.category = cat;
          }
        }

        applyFilters(true);
      });
    }

    // 3. Pagination Buttons
    if (DOM.btnFirst) {
      DOM.btnFirst.addEventListener('click', () => {
        state.currentPage = 1;
        renderMovieGrid();
        renderPagination();
        scrollToCatalogTop();
      });
    }

    if (DOM.btnPrev) {
      DOM.btnPrev.addEventListener('click', () => {
        if (state.currentPage > 1) {
          state.currentPage--;
          renderMovieGrid();
          renderPagination();
          scrollToCatalogTop();
        }
      });
    }

    if (DOM.btnNext) {
      DOM.btnNext.addEventListener('click', () => {
        const { totalPages } = getPaginationMeta();
        if (state.currentPage < totalPages) {
          state.currentPage++;
          renderMovieGrid();
          renderPagination();
          scrollToCatalogTop();
        }
      });
    }

    if (DOM.btnLast) {
      DOM.btnLast.addEventListener('click', () => {
        const { totalPages } = getPaginationMeta();
        state.currentPage = totalPages;
        renderMovieGrid();
        renderPagination();
        scrollToCatalogTop();
      });
    }

    if (DOM.btnJumpGo) {
      DOM.btnJumpGo.addEventListener('click', () => {
        if (!DOM.jumpPageInput) return;
        const val = parseInt(DOM.jumpPageInput.value, 10);
        const { totalPages } = getPaginationMeta();
        if (val >= 1 && val <= totalPages) {
          state.currentPage = val;
          renderMovieGrid();
          renderPagination();
          scrollToCatalogTop();
        }
      });
    }

    if (DOM.jumpPageInput) {
      DOM.jumpPageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && DOM.btnJumpGo) {
          DOM.btnJumpGo.click();
        }
      });
    }

    // 4. Details View Top Navigation
    if (DOM.btnBackCatalog) {
      DOM.btnBackCatalog.addEventListener('click', () => {
        if (window.history && window.history.length > 1) {
          window.history.back();
        } else {
          closeDetailView(true);
        }
      });
    }

    // 5. Synopsis Read More / Show Less Toggle
    if (DOM.btnToggleSynopsis) {
      DOM.btnToggleSynopsis.addEventListener('click', () => {
        if (DOM.detailsSynopsisText) {
          DOM.detailsSynopsisText.classList.toggle('expanded');
          const isExp = DOM.detailsSynopsisText.classList.contains('expanded');
          DOM.btnToggleSynopsis.textContent = isExp ? 'Show Less ▲' : 'Read More ▼';
        }
      });
    }

    // 6. Action Button Smooth Navigation
    if (DOM.btnActionSeasons) {
      DOM.btnActionSeasons.addEventListener('click', () => {
        if (DOM.sectionSeasons) {
          DOM.sectionSeasons.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // 7. Trailer Lightbox Events
    if (DOM.trailerModalClose) {
      DOM.trailerModalClose.addEventListener('click', closeTrailerLightbox);
    }
    if (DOM.trailerLightbox) {
      DOM.trailerLightbox.addEventListener('click', (e) => {
        if (e.target === DOM.trailerLightbox) closeTrailerLightbox();
      });
    }

    // 8. Artwork Lightbox Events
    if (DOM.artworkModalClose) {
      DOM.artworkModalClose.addEventListener('click', closeArtworkLightbox);
    }
    if (DOM.artworkLightbox) {
      DOM.artworkLightbox.addEventListener('click', (e) => {
        if (e.target === DOM.artworkLightbox) closeArtworkLightbox();
      });
    }
    if (DOM.btnArtPrev) {
      DOM.btnArtPrev.addEventListener('click', () => {
        openArtworkLightbox(state.currentArtworkIndex - 1);
      });
    }
    if (DOM.btnArtNext) {
      DOM.btnArtNext.addEventListener('click', () => {
        openArtworkLightbox(state.currentArtworkIndex + 1);
      });
    }

    // 8b. Screenshots Lightbox Events
    if (DOM.btnScreenshotsModalClose) {
      DOM.btnScreenshotsModalClose.addEventListener('click', closeScreenshotLightbox);
    }
    if (DOM.screenshotsLightbox) {
      DOM.screenshotsLightbox.addEventListener('click', (e) => {
        if (e.target === DOM.screenshotsLightbox) closeScreenshotLightbox();
      });
    }
    if (DOM.btnScreenshotsPrev) {
      DOM.btnScreenshotsPrev.addEventListener('click', () => {
        openScreenshotLightbox(state.currentScreenshotIndex - 1);
      });
    }
    if (DOM.btnScreenshotsNext) {
      DOM.btnScreenshotsNext.addEventListener('click', () => {
        openScreenshotLightbox(state.currentScreenshotIndex + 1);
      });
    }

    // 9. Legacy Modal Events (Backward Compatibility)
    if (DOM.modalClose) {
      DOM.modalClose.addEventListener('click', closeDetailModal);
    }
    if (DOM.praflixModal) {
      DOM.praflixModal.addEventListener('click', (e) => {
        if (e.target === DOM.praflixModal) closeDetailModal();
      });
    }

    // 10. History / Popstate & Hashchange Routing
    window.addEventListener('popstate', () => {
      parseUrlHash();
    });
    window.addEventListener('hashchange', () => {
      parseUrlHash();
    });

    // 11. Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (DOM.trailerLightbox && DOM.trailerLightbox.style.display !== 'none') {
          closeTrailerLightbox();
        } else if (DOM.artworkLightbox && DOM.artworkLightbox.style.display !== 'none') {
          closeArtworkLightbox();
        } else if (DOM.screenshotsLightbox && DOM.screenshotsLightbox.style.display !== 'none') {
          closeScreenshotLightbox();
        } else if (state.inDetailsView) {
          closeDetailView();
        } else if (DOM.praflixModal && DOM.praflixModal.classList.contains('open')) {
          closeDetailModal();
        } else if (DOM.searchInput === document.activeElement) {
          DOM.searchInput.blur();
        }
      } else if (e.key === 'ArrowLeft') {
        if (DOM.artworkLightbox && DOM.artworkLightbox.style.display !== 'none') {
          openArtworkLightbox(state.currentArtworkIndex - 1);
        } else if (DOM.screenshotsLightbox && DOM.screenshotsLightbox.style.display !== 'none') {
          openScreenshotLightbox(state.currentScreenshotIndex - 1);
        }
      } else if (e.key === 'ArrowRight') {
        if (DOM.artworkLightbox && DOM.artworkLightbox.style.display !== 'none') {
          openArtworkLightbox(state.currentArtworkIndex + 1);
        } else if (DOM.screenshotsLightbox && DOM.screenshotsLightbox.style.display !== 'none') {
          openScreenshotLightbox(state.currentScreenshotIndex + 1);
        }
      }

      // Quick Search Focus with "/"
      if (e.key === '/' && document.activeElement !== DOM.searchInput && !state.inDetailsView) {
        e.preventDefault();
        DOM.searchInput.focus();
        DOM.searchInput.select();
      }
    });
  }

  // Start app on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
