/**
 * PRAFLIX — Centralized Provider Registry & Source-Catalog Manager
 * A PRAVERSE Company
 *
 * Implements architectural isolation and extensible onboarding:
 * - Centralizes configuration for HDHub4u, 10Moviez, HDWall, and future providers.
 * - Manages independent provider source catalogs at data/source-catalogs/<provider>/.
 * - Tracks per-provider checkpoints (state.json) and last-run execution results (last-run.json).
 * - Enforces provider-specific link eligibility rules, quality extraction, and schedules.
 * - Allows dynamic registration of future providers without rebuilding the engine.
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.dirname(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const SOURCE_CATALOGS_DIR = path.join(DATA_DIR, 'source-catalogs');
const TITLE_LIST_DIR = path.join(BASE_DIR, 'title list');

// In-memory registry table
const registry = new Map();

/**
 * Default Provider Configurations
 */
const DEFAULT_PROVIDERS = [
  {
    id: 'hdhub4u',
    displayName: 'HDHub4u',
    baseUrl: 'https://new7.hdhub4u.cl/',
    candidateBaseUrls: [
      'https://new7.hdhub4u.cl/',
      'https://new2.hdhub4u.free/',
      'https://new1.hdhub4u.free/',
      'https://new3.hdhub4u.free/',
      'https://hdhub4u.tv/'
    ],
    allowedDomains: [
      'new7.hdhub4u.cl',
      'hdhub4u.cl',
      'new1.hdhub4u.free',
      'new2.hdhub4u.free',
      'new3.hdhub4u.free',
      'hdhub4u.free',
      'hdhub4u.tv',
      'hdhub4u.guru'
    ],
    txtFileName: 'HDHUB4U TITLE.txt',
    status: 'active',
    active: true,
    schedule: {
      istTime: '10:00 AM IST',
      utcCron: '30 4 * * *',
      active: true
    },
    categories: [
      { name: 'Bollywood Movies', path: '/category/bollywood-movies/' },
      { name: 'Hollywood Movies', path: '/category/hollywood-movies/' },
      { name: 'Web Series', path: '/category/web-series/' }
    ],
    requireExactHubDrivePrefix: true,
    eligibilityRules: {
      requireStorageDestination: true,
      allowedDestinationDomains: [
        'hubdrive.pics',
        'hblinks.lol',
        'hubcloud.ist'
      ],
      seriesPolicy: 'complete_season_only', // individual episodes excluded
      requireExactHubDrivePrefix: true,
      requiredHubDrivePrefix: 'https://hubdrive.pics/file/',
      approvedPrefixes: [
        'https://hubdrive.pics/file/',
        'https://hblinks.lol/archives/',
        'https://hubcloud.ist/drive/'
      ],
      eligibleUrlPrefixes: [
        'https://hubdrive.pics/file/',
        'https://hblinks.lol/archives/',
        'https://hubcloud.ist/drive/'
      ]
    },
    rateLimit: {
      timeoutMs: 10000,
      maxRetries: 3,
      concurrency: 2
    }
  },
  {
    id: '10moviez',
    displayName: '10Moviez',
    status: 'retired',
    active: false,
    retiredAt: '2026-10-14T21:00:00.000Z',
    retiredReason: 'Retired as active ingestion source; historical download links and catalog entries preserved.',
    baseUrl: 'https://10moviez.biz/',
    allowedDomains: [
      '10moviez.biz',
      '10moviez.org',
      '10moviez.net'
    ],
    txtFileName: '10MOVIEZ TITLE.txt',
    schedule: {
      istTime: '11:00 AM IST',
      utcCron: '30 5 * * *',
      disabled: true
    },
    categories: [
      { name: 'Web Series', path: '/category/web-series/' },
      { name: 'Bollywood', path: '/category/bollywood/' },
      { name: 'Hollywood', path: '/category/hollywood/' }
    ],
    eligibilityRules: {
      requireStorageDestination: true,
      allowedDestinationDomains: [
        'hubdrive.pics',
        'hubcdn.club',
        'hubcdn.wiki',
        'hubcloud.ist',
        'filesdl.in',
        'gdflix.cfd',
        'storage.googleapis.com',
        'drive.google.com'
      ],
      seriesPolicy: 'complete_season_only'
    },
    rateLimit: {
      timeoutMs: 10000,
      maxRetries: 3,
      concurrency: 2
    }
  },
  {
    id: 'hdwall',
    displayName: 'HDWall',
    status: 'retired',
    active: false,
    retiredAt: '2026-10-14T21:00:00.000Z',
    retiredReason: 'Retired as active ingestion source; historical download links and catalog entries preserved.',
    baseUrl: 'https://hdwall.xyz/',
    allowedDomains: [
      'hdwall.xyz',
      'hdwall.org',
      'hdwall.net'
    ],
    txtFileName: 'HDWALL TITLE.txt',
    schedule: {
      istTime: '12:00 PM IST',
      utcCron: '30 6 * * *',
      disabled: true
    },
    categories: [
      { name: 'Movies', path: '/category/movies/' },
      { name: 'Web Series', path: '/category/web-series/' }
    ],
    eligibilityRules: {
      requireStorageDestination: true,
      allowedDestinationDomains: [
        'hubdrive.pics',
        'hubcdn.club',
        'hubcdn.wiki',
        'hubcloud.ist',
        'filesdl.in',
        'gdflix.cfd',
        'storage.googleapis.com',
        'drive.google.com'
      ],
      seriesPolicy: 'complete_season_only'
    },
    rateLimit: {
      timeoutMs: 10000,
      maxRetries: 3,
      concurrency: 2
    }
  },
  {
    id: 'multishows',
    displayName: 'MultiShows',
    status: 'fallback',
    active: false,
    isFallbackOnly: true,
    fallbackFor: 'hdhub4u',
    baseUrl: 'https://multishows.top/',
    candidateBaseUrls: [
      'https://multishows.top/'
    ],
    allowedDomains: [
      'multishows.top'
    ],
    searchEndpoint: 'https://multishows.top/search/',
    txtFileName: 'MULTISHOWS TITLE.txt',
    categories: [
      { name: 'Movies', path: '/movies' },
      { name: 'TV Shows', path: '/tv-shows' }
    ],
    eligibilityRules: {
      requireStorageDestination: true,
      allowedDestinationDomains: [
        'gdflix.dev',
        'gdflix.cfd',
        'hubcloud.ist',
        'hubcloud.icu',
        'hubcloud.club',
        'hubcloud.foo',
        'hubdrive.pics',
        'hblinks.lol',
        'drive.google.com',
        'storage.googleapis.com'
      ],
      seriesPolicy: 'both' // supports both complete season packs and episode-wise variants
    },
    rateLimit: {
      timeoutMs: 10000,
      maxRetries: 3,
      concurrency: 2
    }
  }
];

/**
 * Register a provider in the registry
 */
function registerProvider(config) {
  if (!config || !config.id) {
    throw new Error('Provider registration requires a valid config object with an "id" field.');
  }

  const id = String(config.id).toLowerCase().trim();
  const catalogDir = path.join(SOURCE_CATALOGS_DIR, id);
  const catalogPath = path.join(catalogDir, 'catalog.json');
  const statePath = path.join(catalogDir, 'state.json');
  const lastRunPath = path.join(catalogDir, 'last-run.json');
  const txtFilePath = path.join(TITLE_LIST_DIR, config.txtFileName || `${config.displayName || id.toUpperCase()} TITLE.txt`);

  const fullConfig = {
    ...config,
    id,
    displayName: config.displayName || id.toUpperCase(),
    catalogDir,
    catalogPath,
    statePath,
    lastRunPath,
    txtFilePath
  };

  registry.set(id, fullConfig);
  return fullConfig;
}

/**
 * Initialize default providers
 */
for (const p of DEFAULT_PROVIDERS) {
  registerProvider(p);
}

/**
 * Get provider configuration by ID or display name
 */
function getProvider(identifier) {
  if (!identifier) return null;
  const key = String(identifier).toLowerCase().trim();
  if (registry.has(key)) {
    return registry.get(key);
  }
  for (const p of registry.values()) {
    if (p.displayName.toLowerCase() === key) {
      return p;
    }
  }
  return null;
}

/**
 * Get all registered providers (active and historical/retired)
 */
function getAllProviders() {
  return Array.from(registry.values());
}

/**
 * Get only currently active ingestion providers (HDHub4u)
 */
function getActiveProviders() {
  return Array.from(registry.values()).filter(p => p.status === 'active' || p.active === true);
}

/**
 * Get retired providers (10Moviez, HDWall)
 */
function getRetiredProviders() {
  return Array.from(registry.values()).filter(p => p.status === 'retired' || p.active === false);
}

/**
 * Check if a provider is actively crawled and imported
 */
function isProviderActive(identifier) {
  const p = getProvider(identifier);
  return Boolean(p && (p.status === 'active' || p.active === true));
}

/**
 * Check if a provider has been retired as an ingestion source
 */
function isProviderRetired(identifier) {
  const p = getProvider(identifier);
  return Boolean(p && (p.status === 'retired' || p.active === false));
}

/**
 * Check if a provider exists in registry
 */
function hasProvider(identifier) {
  return Boolean(getProvider(identifier));
}

/**
 * Load provider's independent source catalog
 */
function loadSourceCatalog(providerId) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: "${providerId}"`);

  if (!fs.existsSync(p.catalogDir)) {
    fs.mkdirSync(p.catalogDir, { recursive: true });
  }

  if (fs.existsSync(p.catalogPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(p.catalogPath, 'utf8'));
      return Array.isArray(data) ? data : (data.records || []);
    } catch (err) {
      console.warn(`[WARN] Failed to parse source catalog for ${p.displayName}:`, err.message);
      return [];
    }
  }
  return [];
}

/**
 * Persist provider's independent source catalog atomically
 */
function saveSourceCatalog(providerId, records) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: "${providerId}"`);

  if (!fs.existsSync(p.catalogDir)) {
    fs.mkdirSync(p.catalogDir, { recursive: true });
  }

  const payload = {
    provider: p.displayName,
    providerId: p.id,
    lastUpdated: new Date().toISOString(),
    recordCount: records.length,
    records: records
  };

  const tmpPath = `${p.catalogPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, p.catalogPath);
}

/**
 * Load provider state / checkpoint
 */
function loadState(providerId) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: "${providerId}"`);

  if (fs.existsSync(p.statePath)) {
    try {
      return JSON.parse(fs.readFileSync(p.statePath, 'utf8'));
    } catch (_) {
      return {};
    }
  }
  return {
    lastScanTimestamp: null,
    lastSuccessfulScanTimestamp: null,
    scanStatus: 'idle',
    lastPageProcessed: 0,
    visitedUrls: []
  };
}

/**
 * Save provider state / checkpoint
 */
function saveState(providerId, state) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: "${providerId}"`);

  if (!fs.existsSync(p.catalogDir)) {
    fs.mkdirSync(p.catalogDir, { recursive: true });
  }

  const tmpPath = `${p.statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, p.statePath);
}

/**
 * Load provider last-run summary
 */
function loadLastRun(providerId) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: "${providerId}"`);

  if (fs.existsSync(p.lastRunPath)) {
    try {
      return JSON.parse(fs.readFileSync(p.lastRunPath, 'utf8'));
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Save provider last-run summary atomically
 */
function saveLastRun(providerId, runResult) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: "${providerId}"`);

  if (!fs.existsSync(p.catalogDir)) {
    fs.mkdirSync(p.catalogDir, { recursive: true });
  }

  const tmpPath = `${p.lastRunPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(runResult, null, 2), 'utf8');
  fs.renameSync(tmpPath, p.lastRunPath);
}

module.exports = {
  registerProvider,
  getProvider,
  getProviderConfig: getProvider,
  getAllProviders,
  getActiveProviders,
  getRetiredProviders,
  isProviderActive,
  isProviderRetired,
  hasProvider,
  loadSourceCatalog,
  saveSourceCatalog,
  loadState,
  saveState,
  loadLastRun,
  saveLastRun,
  SOURCE_CATALOGS_DIR,
  TITLE_LIST_DIR
};
