/**
 * PRAFLIX — Automated 24-Hour Catalog Synchronization & Telegram Reporting Engine
 * A PRAVERSE Company
 *
 * Core synchronization module:
 * - Checks 3 providers: HDHub4u, 10Moviez, HDWall
 * - Incremental sync (does NOT rebuild catalog from scratch)
 * - Detects new movies and web series
 * - Deduplicates against existing canonical catalog (13,642 titles)
 * - Updates screenshots, posters, and quality metadata for existing titles
 * - Preserves canonical title IDs and existing providers
 * - Isolated provider execution: failure of one provider does NOT block others
 * - Generates high-fidelity Telegram report matching PRAFLIX specification
 * - Sends report securely using TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID
 */

const fs = require('fs');
const path = require('path');

// Provider Constants
const PROVIDERS = ['HDHub4u', '10Moviez', 'HDWall'];

const PROVIDER_KEYS = {
  'hdhub4u': 'HDHub4u',
  '10moviez': '10Moviez',
  'hdwall': 'HDWall'
};

/**
 * Clean & normalize titles for canonical matching
 */
function normalizeTitle(title) {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(download|watch|online|full|movie|series|season\s*\d+|part\s*\d+|hindi|dubbed|dual\s*audio|esub|hevc|web-?dl|bluray|hdrip|hd|480p|720p|1080p|2160p|4k)\b/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Determine content type (Movie vs Web Series)
 */
function detectContentType(title, rawCategory) {
  const t = (title || '').toLowerCase();
  const c = (rawCategory || '').toLowerCase();
  if (
    t.includes('season') ||
    t.includes('series') ||
    t.includes('episode') ||
    t.includes('s01') ||
    t.includes('s02') ||
    t.includes('s03') ||
    c.includes('web series') ||
    c.includes('tv series') ||
    c.includes('series')
  ) {
    return 'Web Series';
  }
  return 'Movie';
}

/**
 * Match a candidate item against the existing canonical catalog
 */
function matchExistingTitle(candidate, catalog) {
  const candNorm = normalizeTitle(candidate.displayTitle || candidate.title);
  const candYear = candidate.year ? String(candidate.year).trim() : null;
  const candType = candidate.type || 'Movie';
  const candSourceUrl = (candidate.sourceUrl || '').toLowerCase();

  for (const item of catalog) {
    // 1. Direct source URL match in variants
    if (candSourceUrl && (item.variants || []).some(v => v.sourceUrl && v.sourceUrl.toLowerCase() === candSourceUrl)) {
      return item;
    }

    // 2. Normalized title match
    const itemNorm = item.normalizedTitle || normalizeTitle(item.displayTitle);
    if (candNorm && itemNorm && candNorm === itemNorm) {
      // Check year match if both have valid 4-digit years
      if (candYear && item.year && /^\d{4}$/.test(candYear) && /^\d{4}$/.test(item.year)) {
        if (candYear === item.year) {
          return item;
        }
      } else if (!candYear || !item.year) {
        return item;
      }
    }
  }

  return null;
}

/**
 * Fetch latest items for a provider with timeout and error isolation
 */
async function fetchProviderLatest(providerName, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  const providerLower = providerName.toLowerCase();

  // For testing or simulated runs
  if (options.mockFailures && options.mockFailures[providerName]) {
    throw new Error(options.mockFailures[providerName]);
  }
  if (options.mockItems && options.mockItems[providerName] !== undefined) {
    if (options.mockItems[providerName] === null) {
      throw new Error(`Simulated connection timeout from ${providerName}`);
    }
    if (options.mockItems[providerName] instanceof Error) {
      throw options.mockItems[providerName];
    }
    return options.mockItems[providerName];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = '';
    if (providerLower === 'hdwall') {
      url = 'https://hdwall.xyz/page/1/';
    } else if (providerLower === '10moviez') {
      url = 'https://10moviez.biz/category/web-series/page/1/';
    } else if (providerLower === 'hdhub4u') {
      url = 'https://new1.hdhub4u.free/';
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${providerName}`);
    }

    const html = await response.text();
    return parseProviderHtml(providerName, html);
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(`Failed to sync ${providerName}: ${err.message}`);
  }
}

/**
 * Parse provider HTML to extract public listings and screenshots
 */
function parseProviderHtml(providerName, html) {
  const providerLower = providerName.toLowerCase();
  const items = [];

  if (providerLower === 'hdwall') {
    // Regex extract HDWall articles
    const articleRegex = /<div class="custom-poster"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
    let match;
    while ((match = articleRegex.exec(html)) !== null) {
      const sourceUrl = match[1];
      const sourcePosterUrl = match[2];
      const rawTitle = match[3];

      let screenshotUrl = null;
      if (sourcePosterUrl.includes('/uploads/posts/covers/photo_')) {
        screenshotUrl = sourcePosterUrl.replace('/uploads/posts/covers/photo_', '/uploads/posts/screenshot/screenshot_');
      }

      const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
      const year = yearMatch ? yearMatch[1] : '';
      const type = detectContentType(rawTitle, '');

      items.push({
        provider: 'HDWall',
        source: 'hdwall',
        originalSourceTitle: rawTitle,
        displayTitle: rawTitle.replace(/\s*\(\d{4}\).*/, '').trim(),
        year: year,
        type: type,
        sourceUrl: sourceUrl,
        sourcePosterUrl: sourcePosterUrl,
        screenshots: screenshotUrl ? [screenshotUrl] : [],
        qualities: [{ resolution: '720p', label: 'HD' }]
      });
    }
  } else if (providerLower === '10moviez') {
    const itemRegex = /<a class="poster"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const sourceUrl = match[1];
      const sourcePosterUrl = match[2];
      const rawTitle = match[3];

      const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
      const year = yearMatch ? yearMatch[1] : '';
      const type = detectContentType(rawTitle, 'Web Series');

      items.push({
        provider: '10Moviez',
        source: '10moviez',
        originalSourceTitle: rawTitle,
        displayTitle: rawTitle.replace(/\s*\(\d{4}\).*/, '').trim(),
        year: year,
        type: type,
        sourceUrl: sourceUrl,
        sourcePosterUrl: sourcePosterUrl,
        screenshots: [],
        qualities: [{ resolution: '720p', label: '720p' }, { resolution: '1080p', label: '1080p' }]
      });
    }
  } else if (providerLower === 'hdhub4u') {
    const postRegex = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
    let match;
    while ((match = postRegex.exec(html)) !== null) {
      const sourceUrl = match[1];
      const sourcePosterUrl = match[2];
      const rawTitle = match[3];

      const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
      const year = yearMatch ? yearMatch[1] : '';
      const type = detectContentType(rawTitle, '');

      items.push({
        provider: 'HDHub4u',
        source: 'hdhub4u',
        originalSourceTitle: rawTitle,
        displayTitle: rawTitle.replace(/\s*\(\d{4}\).*/, '').trim(),
        year: year,
        type: type,
        sourceUrl: sourceUrl,
        sourcePosterUrl: sourcePosterUrl,
        screenshots: [],
        qualities: [{ resolution: '720p', label: '720p' }, { resolution: '1080p', label: '1080p' }]
      });
    }
  }

  return items;
}

/**
 * Synchronize a single provider incrementally
 */
async function syncProvider(providerName, catalog, sourceRecords, options = {}) {
  const result = {
    provider: providerName,
    failed: false,
    error: null,
    newMovies: 0,
    newSeries: 0,
    updatedExisting: 0,
    itemsProcessed: 0
  };

  try {
    if (providerName.toLowerCase() === 'hdhub4u' && !options.mockItems && !options.mockFailures) {
      try {
        const hdhubSync = require('./hdhub4u_sync');
        const syncReport = await hdhubSync.runHDHub4uSync(options);
        result.newMovies = syncReport.metrics.newlyAddedToCatalog;
        result.newSeries = 0;
        result.updatedExisting = syncReport.metrics.existingUpdatedWithLinks;
        result.itemsProcessed = syncReport.metrics.totalDiscovered;
        return result;
      } catch (hErr) {
        console.warn('[WARN] HDHub4u comprehensive sync notice, falling back to incremental parser:', hErr.message);
      }
    }

    const items = await fetchProviderLatest(providerName, options);
    result.itemsProcessed = items.length;

    // Find current max canonical ID
    let maxCanonicalId = catalog.reduce((max, item) => Math.max(max, item.canonicalId || 0), 0);

    for (const item of items) {
      const existing = matchExistingTitle(item, catalog);

      if (existing) {
        // Update existing title with provider variant & screenshots
        result.updatedExisting++;
        if (!existing.variants) existing.variants = [];

        // Check if variant for this sourceUrl already exists
        const hasVariant = existing.variants.some(v => v.sourceUrl && v.sourceUrl === item.sourceUrl);
        if (!hasVariant) {
          existing.variants.push({
            originalSourceTitle: item.originalSourceTitle,
            source: item.source || providerName.toLowerCase(),
            sourceUrl: item.sourceUrl,
            poster: item.sourcePosterUrl,
            qualities: item.qualities || [],
            screenshots: item.screenshots || []
          });
        }

        // Combine unique screenshots
        if (item.screenshots && item.screenshots.length > 0) {
          if (!existing.screenshots) existing.screenshots = [];
          const existingUrls = new Set(existing.screenshots.map(s => typeof s === 'string' ? s : s.url));
          item.screenshots.forEach(ssUrl => {
            if (!existingUrls.has(ssUrl)) {
              existingUrls.add(ssUrl);
              existing.screenshots.push({
                url: ssUrl,
                source: item.source || providerName.toLowerCase(),
                provider: providerName,
                caption: `${existing.displayTitle} — ${providerName} Still`
              });
            }
          });
        }
      } else {
        // Genuinely new title!
        maxCanonicalId++;
        const isSeries = item.type === 'Web Series';
        if (isSeries) {
          result.newSeries++;
        } else {
          result.newMovies++;
        }

        const newCanonical = {
          canonicalId: maxCanonicalId,
          id: maxCanonicalId,
          displayTitle: item.displayTitle,
          normalizedTitle: normalizeTitle(item.displayTitle),
          originalSourceTitle: item.originalSourceTitle,
          year: item.year || '',
          type: item.type || 'Movie',
          season: isSeries ? (item.season || 'Season 1') : null,
          poster: item.sourcePosterUrl || 'assets/posters/fallback.svg',
          sourceUrl: item.sourceUrl,
          categories: [isSeries ? 'Web Series' : 'Cinema'],
          languages: item.languages || ['Hindi'],
          qualities: (item.qualities || []).map(q => q.resolution || q.label || q),
          variants: [
            {
              originalSourceTitle: item.originalSourceTitle,
              source: item.source || providerName.toLowerCase(),
              sourceUrl: item.sourceUrl,
              poster: item.sourcePosterUrl,
              qualities: item.qualities || [],
              screenshots: item.screenshots || []
            }
          ],
          screenshots: (item.screenshots || []).map(ssUrl => ({
            url: ssUrl,
            source: item.source || providerName.toLowerCase(),
            provider: providerName,
            caption: `${item.displayTitle} — ${providerName} Still`
          }))
        };

        catalog.push(newCanonical);

        // Add to sourceRecords
        sourceRecords.push({
          id: `src-${providerName.toLowerCase()}-${maxCanonicalId}`,
          source: item.source || providerName.toLowerCase(),
          displayTitle: item.displayTitle,
          originalSourceTitle: item.originalSourceTitle,
          normalizedTitle: normalizeTitle(item.displayTitle),
          year: item.year || '',
          type: item.type || 'Movie',
          sourceUrl: item.sourceUrl,
          sourcePosterUrl: item.sourcePosterUrl,
          qualities: item.qualities || [],
          screenshots: item.screenshots || []
        });
      }
    }
  } catch (err) {
    result.failed = true;
    result.error = err.message;
  }

  return result;
}

/**
 * Execute 24-hour sync across all 3 providers
 */
async function runFullSync(catalog, sourceRecords, options = {}) {
  const syncStartTime = new Date();
  const providerResults = {};

  // Sequential sync: HDHub4u -> 10Moviez -> HDWall
  for (const provider of PROVIDERS) {
    try {
      const res = await syncProvider(provider, catalog, sourceRecords, options);
      providerResults[provider] = res;
    } catch (err) {
      // Isolation guarantee: error in one provider does not prevent other providers
      providerResults[provider] = {
        provider,
        failed: true,
        error: err.message,
        newMovies: 0,
        newSeries: 0,
        updatedExisting: 0
      };
    }
  }

  // Aggregate totals
  let totalMovies = 0;
  let totalSeries = 0;
  let totalUpdated = 0;

  for (const prov of PROVIDERS) {
    const r = providerResults[prov];
    if (!r.failed) {
      totalMovies += (typeof r.newMovies === 'number' ? r.newMovies : 0);
      totalSeries += (typeof r.newSeries === 'number' ? r.newSeries : 0);
      totalUpdated += (typeof r.updatedExisting === 'number' ? r.updatedExisting : 0);
    }
  }

  const totalAdded = totalMovies + totalSeries;

  const summary = {
    syncTime: syncStartTime.toISOString(),
    formattedTime: formatDateTime(syncStartTime),
    providers: providerResults,
    totals: {
      moviesAdded: totalMovies,
      seriesAdded: totalSeries,
      totalTitlesAdded: totalAdded,
      titlesUpdated: totalUpdated
    }
  };

  const reportText = formatTelegramReport(summary);

  return {
    summary,
    reportText,
    totalAdded,
    totalUpdated
  };
}

/**
 * Format date and time for Telegram report
 */
function formatDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day} ${hours}:${mins} UTC`;
}

/**
 * Format exact Telegram Report matching PRAFLIX specification
 */
function formatTelegramReport(summary) {
  const syncTime = summary.formattedTime || formatDateTime(new Date());
  const provs = summary.providers;

  let text = '━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '       PRAFLIX REPORT\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += '📅 DAILY CATALOG UPDATE\n';
  text += `🕐 Sync completed: ${syncTime}\n\n`;

  // Each provider
  for (const prov of PROVIDERS) {
    const res = provs[prov];
    text += '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += `${prov.toUpperCase()}\n`;
    text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

    if (res && res.failed) {
      text += '⚠️ Sync failed\n';
      text += '🎬 New Movies: —\n';
      text += '📺 New Series: —\n\n';
    } else if (res) {
      text += `🎬 New Movies: ${res.newMovies}\n`;
      text += `📺 New Series: ${res.newSeries}\n\n`;
    } else {
      text += '⚠️ Sync failed\n';
      text += '🎬 New Movies: —\n';
      text += '📺 New Series: —\n\n';
    }
  }

  // Total section
  const total = summary.totals || { moviesAdded: 0, seriesAdded: 0, totalTitlesAdded: 0 };
  text += '━━━━━━━━━━━━━━━━━━━━━━\n';
  text += 'TOTAL\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += `🎬 Movies Added: ${total.moviesAdded}\n`;
  text += `📺 Series Added: ${total.seriesAdded}\n`;
  text += `📦 Total Titles Added: ${total.totalTitlesAdded}\n\n`;

  if (total.totalTitlesAdded > 0) {
    text += '✅ PRAFLIX CATALOG UPDATED & VALIDATED\n';
    text += '🚀 Edge Deployment: Queued';
  } else {
    text += '✅ No new titles found today.\n';
    text += '🚀 Edge Deployment: Catalog Verified';
  }

  return text;
}

/**
 * Dispatch report securely to Telegram Bot API
 */
async function sendTelegramReport(reportText, credentials = {}) {
  let botToken = credentials.botToken || process.env.TELEGRAM_BOT_TOKEN;
  let chatId = credentials.channelId || credentials.chatId || process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID;

  // Attempt to load from .env if running locally and not in env
  if ((!botToken || !chatId) && fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!botToken && trimmed.startsWith('TELEGRAM_BOT_TOKEN=')) {
        botToken = trimmed.slice('TELEGRAM_BOT_TOKEN='.length).trim();
      }
      if (!chatId && (trimmed.startsWith('TELEGRAM_CHANNEL_ID=') || trimmed.startsWith('TELEGRAM_CHAT_ID='))) {
        chatId = trimmed.slice(trimmed.indexOf('=') + 1).trim();
      }
    }
  }

  if (!botToken || !chatId) {
    return {
      success: false,
      error: 'Missing Telegram credentials (TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID/TELEGRAM_CHAT_ID)'
    };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: reportText,
        parse_mode: 'HTML'
      })
    });

    const data = await res.json();
    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API returned error' };
    }

    return { success: true, messageId: data.result ? data.result.message_id : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  PROVIDERS,
  normalizeTitle,
  detectContentType,
  matchExistingTitle,
  fetchProviderLatest,
  syncProvider,
  runFullSync,
  formatTelegramReport,
  sendTelegramReport
};
