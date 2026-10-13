#!/usr/bin/env node
/**
 * PRAFLIX — Title List Synchronization Engine
 * A PRAVERSE Company
 *
 * Implements title list synchronization for:
 * - HDHub4u -> title list/HDHUB4U TITLE.txt
 * - 10Moviez -> title list/10MOVIEZ TITLE.txt
 * - HDWall -> title list/HDWALL TITLE.txt
 *
 * Requirements:
 * - Format: DD/MM/YY Title Name (e.g. 13/10/26 Only Me) in Asia/Kolkata time zone
 * - Append-only: Preserves all existing lines and order.
 * - Duplicate prevention: Normalizes whitespace, punctuation, casing, tags, entity artifacts.
 * - Idempotent: Repeated syncs do not append duplicates.
 * - Provider separation: Never writes titles to the wrong provider file.
 * - Ingestion gate: Only appends after successful catalog/source-record ingestion with eligible links.
 */

const fs = require('fs');
const path = require('path');
const titleDecoder = require('./title_decoder');

const BASE_DIR = path.dirname(__dirname);

function resolveTitleListDir() {
  const p1 = path.join(BASE_DIR, 'title list');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(BASE_DIR, 'TITLE LIST');
  if (fs.existsSync(p2)) return p2;
  return p1;
}

const TITLE_LIST_DIR = resolveTitleListDir();

const PROVIDER_FILES = {
  'hdhub4u': 'HDHUB4U TITLE.txt',
  '10moviez': '10MOVIEZ TITLE.txt',
  'hdwall': 'HDWALL TITLE.txt'
};

/**
 * Format date strictly as DD/MM/YY in Asia/Kolkata time zone
 * Avoids runner UTC date drift around midnight
 * @param {Date} [d]
 * @returns {string} e.g. "13/10/26"
 */
function formatTitleListDate(d = new Date()) {
  const dateObj = (d instanceof Date && !isNaN(d)) ? d : new Date();
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).format(dateObj);
}

/**
 * Clean display title for human-readable entry in title list
 * Decodes HTML entities and strips residual artifacts
 * @param {string} rawTitle
 * @returns {string}
 */
function cleanTitleForEntry(rawTitle) {
  if (!rawTitle) return '';
  return titleDecoder.cleanTitle(rawTitle);
}

/**
 * Extract normalized comparison keys from a title string (both with year and without year)
 * @param {string} str
 * @returns {string[]}
 */
function extractTitleKeys(str) {
  if (!str) return [];
  // Strip date prefix if present e.g. "13/10/26 Only Me"
  let s = String(str)
    .replace(/^[-*•]\s*/, '')
    .replace(/^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s+/, '');

  s = titleDecoder.cleanTitle(s);

  // Extract up through 4-digit year if present: e.g. 'Adbhut (2024)'
  const m = s.match(/^(.*?)(?:\s*\(?(19\d{2}|20\d{2})\)?(?:\s|$)|$)/);
  let mainTitle = m ? m[1] : s;
  let year = m && m[2] ? m[2] : '';

  // Clean media keywords if they appeared before the year
  mainTitle = mainTitle
    .replace(/\b(download|watch|online|full|movie|series|season\s*\d+|part\s*\d+|hindi|dubbed|dual\s*audio|esub|hevc|web-?dl|webrip|bluray|hdrip|hd|hdtv|hdtc|480p|720p|1080p|2160p|4k)\b/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!mainTitle) return [];

  const keys = [mainTitle];
  if (year) {
    keys.push(`${mainTitle} ${year}`);
  }
  return keys;
}

function normalizeTitleForComparison(title) {
  const keys = extractTitleKeys(title);
  return keys.length > 0 ? keys[keys.length - 1] : '';
}

/**
 * Get file path for a provider
 */
function getProviderFilePath(providerName) {
  const key = String(providerName || '').toLowerCase().trim();
  const filename = PROVIDER_FILES[key];
  if (!filename) {
    throw new Error(`Unknown provider: "${providerName}". Supported: ${Object.keys(PROVIDER_FILES).join(', ')}`);
  }
  return path.join(TITLE_LIST_DIR, filename);
}

/**
 * Load existing entries and build normalized lookup set
 */
function loadExistingTitles(filePath) {
  if (!fs.existsSync(filePath)) {
    return { lines: [], normalizedSet: new Set() };
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const normalizedSet = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip section headers or summary labels
    if (trimmed.startsWith('===') || trimmed.startsWith('---') || trimmed.startsWith('Source:') ||
        trimmed.startsWith('Last inventory') || trimmed.startsWith('RECONCILIATION') ||
        trimmed.startsWith('ADDED TO PRAFLIX') || trimmed.startsWith('UNRESOLVED') ||
        trimmed.startsWith('COMPLETE INVENTORY') || trimmed === 'MOVIES' || trimmed === 'WEB SERIES') {
      continue;
    }

    const keys = extractTitleKeys(trimmed);
    for (const k of keys) {
      normalizedSet.add(k);
    }
  }

  return { lines, raw, normalizedSet };
}

/**
 * Synchronize newly discovered titles to a provider's TXT title list file
 *
 * @param {string} providerName - 'HDHub4u', '10Moviez', or 'HDWall'
 * @param {Array<string|object>} candidateTitles - Array of title names or objects
 * @param {object} options - { date: Date, dryRun: boolean }
 * @returns {object} { success: boolean, appendedCount: number, skippedCount: number, appendedTitles: string[] }
 */
function syncProviderTitleList(providerName, candidateTitles = [], options = {}) {
  const filePath = getProviderFilePath(providerName);
  const { lines, raw, normalizedSet } = loadExistingTitles(filePath);

  const entryDate = formatTitleListDate(options.date || new Date());
  const appendedTitles = [];
  const appendedEntries = [];
  let skippedCount = 0;

  for (const item of candidateTitles) {
    const rawTitle = typeof item === 'string' ? item : (item.displayTitle || item.title || item.originalSourceTitle || '');
    if (!rawTitle) continue;

    const cleanTitle = cleanTitleForEntry(rawTitle);
    if (!cleanTitle) continue;

    const keys = extractTitleKeys(rawTitle);
    if (keys.length === 0) continue;

    const cleanLower = cleanTitle.toLowerCase().trim();
    const normClean = normalizeTitleForComparison(cleanTitle);

    const isDuplicate = keys.some(k => normalizedSet.has(k)) ||
                        normalizedSet.has(cleanLower) ||
                        (normClean && normalizedSet.has(normClean));
    if (isDuplicate) {
      skippedCount++;
      continue;
    }

    const entryLine = `${entryDate} ${cleanTitle}`;

    appendedTitles.push(entryLine);
    appendedEntries.push({
      title: cleanTitle,
      date: entryDate,
      provider: providerName,
      formattedEntry: entryLine
    });

    for (const k of keys) {
      normalizedSet.add(k); // Prevent duplicates within the same batch
    }
    normalizedSet.add(cleanLower);
    if (normClean) normalizedSet.add(normClean);
  }

  if (appendedTitles.length > 0 && !options.dryRun) {
    // Append-only: preserve existing file content and append new lines at the end
    let appendPayload = appendedTitles.join('\n') + '\n';
    if (raw && !raw.endsWith('\n') && !raw.endsWith('\r\n')) {
      appendPayload = '\n' + appendPayload;
    }
    fs.appendFileSync(filePath, appendPayload, 'utf8');
  }

  return {
    success: true,
    provider: providerName,
    filePath,
    appendedCount: appendedTitles.length,
    skippedCount,
    appendedTitles,
    appendedEntries
  };
}

module.exports = {
  TITLE_LIST_DIR,
  PROVIDER_FILES,
  getProviderFilePath,
  formatTitleListDate,
  cleanTitleForEntry,
  normalizeTitleForComparison,
  extractTitleKeys,
  loadExistingTitles,
  syncProviderTitleList
};
