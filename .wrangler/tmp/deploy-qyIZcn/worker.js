var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// scripts/d1_sync.js
var PROVIDERS = ["HDHub4u", "10Moviez", "HDWall"];
var PROVIDER_URLS = {
  "HDHub4u": "https://new1.hdhub4u.free/",
  "10Moviez": "https://10moviez.biz/category/web-series/page/1/",
  "HDWall": "https://hdwall.xyz/page/1/"
};
function normalizeTitle(title) {
  if (!title) return "";
  return String(title).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(download|watch|online|full|movie|series|season\s*\d+|part\s*\d+|hindi|dubbed|dual\s*audio|esub|hevc|web-?dl|bluray|hdrip|hd|480p|720p|1080p|2160p|4k)\b/gi, " ").replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
__name(normalizeTitle, "normalizeTitle");
function detectContentType(title, rawCategory) {
  const t = (title || "").toLowerCase();
  const c = (rawCategory || "").toLowerCase();
  if (t.includes("season") || t.includes("series") || t.includes("episode") || t.includes("s01") || t.includes("s02") || t.includes("s03") || c.includes("web series") || c.includes("tv series") || c.includes("series")) {
    return "Web Series";
  }
  return "Movie";
}
__name(detectContentType, "detectContentType");
function parseHDWall(html) {
  const items = [];
  const articleRegex = /<div class="custom-poster"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const sourceUrl = match[1];
    const sourcePosterUrl = match[2];
    const rawTitle = match[3];
    let screenshotUrl = null;
    if (sourcePosterUrl.includes("/uploads/posts/covers/photo_")) {
      screenshotUrl = sourcePosterUrl.replace("/uploads/posts/covers/photo_", "/uploads/posts/screenshot/screenshot_");
    }
    const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : "";
    items.push({
      provider: "HDWall",
      source: "hdwall",
      originalSourceTitle: rawTitle,
      displayTitle: rawTitle.replace(/\s*\(\d{4}\).*/, "").trim(),
      year,
      type: detectContentType(rawTitle, ""),
      sourceUrl,
      sourcePosterUrl,
      screenshots: screenshotUrl ? [screenshotUrl] : [],
      qualities: [{ resolution: "720p", label: "HD" }]
    });
  }
  return items;
}
__name(parseHDWall, "parseHDWall");
function parse10Moviez(html) {
  const items = [];
  const itemRegex = /<a class="poster"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const sourceUrl = match[1];
    const sourcePosterUrl = match[2];
    const rawTitle = match[3];
    const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : "";
    items.push({
      provider: "10Moviez",
      source: "10moviez",
      originalSourceTitle: rawTitle,
      displayTitle: rawTitle.replace(/\s*\(\d{4}\).*/, "").trim(),
      year,
      type: detectContentType(rawTitle, "Web Series"),
      sourceUrl,
      sourcePosterUrl,
      screenshots: [],
      qualities: [{ resolution: "720p", label: "720p" }, { resolution: "1080p", label: "1080p" }]
    });
  }
  return items;
}
__name(parse10Moviez, "parse10Moviez");
function parseHDHub4u(html) {
  const items = [];
  const postRegex = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img [^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g;
  let match;
  while ((match = postRegex.exec(html)) !== null) {
    const sourceUrl = match[1];
    const sourcePosterUrl = match[2];
    const rawTitle = match[3];
    const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : "";
    items.push({
      provider: "HDHub4u",
      source: "hdhub4u",
      originalSourceTitle: rawTitle,
      displayTitle: rawTitle.replace(/\s*\(\d{4}\).*/, "").trim(),
      year,
      type: detectContentType(rawTitle, ""),
      sourceUrl,
      sourcePosterUrl,
      screenshots: [],
      qualities: [{ resolution: "720p", label: "720p" }, { resolution: "1080p", label: "1080p" }]
    });
  }
  return items;
}
__name(parseHDHub4u, "parseHDHub4u");
async function fetchProviderPage(providerName, timeoutMs = 2e4) {
  const url = PROVIDER_URLS[providerName];
  if (!url) throw new Error(`Unknown provider: ${providerName}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PRAFLIX-Bot/2.0)" }
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${providerName}`);
    const html = await resp.text();
    if (providerName === "HDWall") return parseHDWall(html);
    if (providerName === "10Moviez") return parse10Moviez(html);
    if (providerName === "HDHub4u") return parseHDHub4u(html);
    return [];
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`Fetch failed for ${providerName}: ${e.message}`);
  }
}
__name(fetchProviderPage, "fetchProviderPage");
async function findExistingCanonical(db, item) {
  if (item.sourceUrl) {
    const row2 = await db.prepare(
      "SELECT canonical_id FROM variants WHERE source_url = ?1 LIMIT 1"
    ).bind(item.sourceUrl).first();
    if (row2) return row2.canonical_id;
  }
  const normTitle = normalizeTitle(item.displayTitle || item.originalSourceTitle);
  if (!normTitle) return null;
  if (item.year) {
    const row2 = await db.prepare(
      "SELECT canonical_id FROM canonical_titles WHERE normalized_title = ?1 AND year = ?2 LIMIT 1"
    ).bind(normTitle, String(item.year)).first();
    if (row2) return row2.canonical_id;
  }
  const row = await db.prepare(
    "SELECT canonical_id FROM canonical_titles WHERE normalized_title = ?1 LIMIT 1"
  ).bind(normTitle).first();
  return row ? row.canonical_id : null;
}
__name(findExistingCanonical, "findExistingCanonical");
async function getMaxCanonicalId(db) {
  const row = await db.prepare("SELECT MAX(canonical_id) as maxid FROM canonical_titles").first();
  return row ? row.maxid || 13642 : 13642;
}
__name(getMaxCanonicalId, "getMaxCanonicalId");
async function insertNewCanonicalTitle(db, item, newId) {
  const normTitle = normalizeTitle(item.displayTitle);
  const isSeries = item.type === "Web Series";
  const genres = JSON.stringify(isSeries ? ["Web Series"] : ["Cinema"]);
  const qualities = JSON.stringify((item.qualities || []).map((q) => q.resolution || q.label || q));
  await db.prepare(`
    INSERT INTO canonical_titles
      (canonical_id, id, display_title, original_source_title, normalized_title,
       year, type, season, status,
       genres, languages, qualities,
       poster, source_poster_url, variant_count,
       created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active',
            ?9, ?10, ?11, ?12, ?13, 1,
            strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).bind(
    newId,
    `praflix-${newId}`,
    item.displayTitle,
    item.originalSourceTitle,
    normTitle,
    item.year || "",
    item.type || "Movie",
    isSeries ? item.season || "Season 1" : null,
    genres,
    JSON.stringify(item.languages || ["Hindi"]),
    qualities,
    item.sourcePosterUrl || "assets/posters/fallback.svg",
    item.sourcePosterUrl || null
  ).run();
}
__name(insertNewCanonicalTitle, "insertNewCanonicalTitle");
async function upsertVariant(db, canonicalId, item) {
  if (!item.sourceUrl) return;
  const existing = await db.prepare(
    "SELECT id FROM variants WHERE canonical_id = ?1 AND source_url = ?2 LIMIT 1"
  ).bind(canonicalId, item.sourceUrl).first();
  if (!existing) {
    await db.prepare(`
      INSERT INTO variants (canonical_id, original_source_title, source, source_url, poster, qualities)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      canonicalId,
      item.originalSourceTitle,
      item.source || "unknown",
      item.sourceUrl,
      item.sourcePosterUrl || null,
      JSON.stringify(item.qualities || [])
    ).run();
  }
}
__name(upsertVariant, "upsertVariant");
async function insertNewScreenshots(db, canonicalId, screenshots, providerName, displayTitle) {
  for (const ssUrl of screenshots || []) {
    if (!ssUrl) continue;
    try {
      await db.prepare(`
        INSERT OR IGNORE INTO screenshots (canonical_id, url, source, provider, caption)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(
        canonicalId,
        ssUrl,
        providerName.toLowerCase(),
        providerName,
        `${displayTitle} \u2014 ${providerName} Still`
      ).run();
    } catch (_) {
    }
  }
}
__name(insertNewScreenshots, "insertNewScreenshots");
async function syncProvider(providerName, db) {
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
    const items = await fetchProviderPage(providerName);
    result.itemsProcessed = items.length;
    if (items.length === 0) {
      return result;
    }
    let maxId = await getMaxCanonicalId(db);
    for (const item of items) {
      try {
        const existingId = await findExistingCanonical(db, item);
        if (existingId !== null) {
          await upsertVariant(db, existingId, item);
          await insertNewScreenshots(db, existingId, item.screenshots, providerName, item.displayTitle);
          await db.prepare(
            "UPDATE canonical_titles SET variant_count = (SELECT COUNT(*) FROM variants WHERE canonical_id = ?1), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE canonical_id = ?1"
          ).bind(existingId).run();
          result.updatedExisting++;
        } else {
          maxId++;
          await insertNewCanonicalTitle(db, item, maxId);
          await upsertVariant(db, maxId, item);
          await insertNewScreenshots(db, maxId, item.screenshots, providerName, item.displayTitle);
          if (item.type === "Web Series") {
            result.newSeries++;
          } else {
            result.newMovies++;
          }
        }
      } catch (itemErr) {
        console.error(`[PRAFLIX Sync] Item error (${providerName}): ${itemErr.message}`);
      }
    }
  } catch (e) {
    result.failed = true;
    result.error = e.message;
  }
  return result;
}
__name(syncProvider, "syncProvider");
async function runFullD1Sync(db) {
  const syncTime = (/* @__PURE__ */ new Date()).toISOString();
  const providerResults = {};
  for (const provider of PROVIDERS) {
    try {
      providerResults[provider] = await syncProvider(provider, db);
    } catch (e) {
      providerResults[provider] = {
        provider,
        failed: true,
        error: e.message,
        newMovies: 0,
        newSeries: 0,
        updatedExisting: 0,
        itemsProcessed: 0
      };
    }
  }
  for (const provider of PROVIDERS) {
    const r = providerResults[provider];
    try {
      await db.prepare(`
        INSERT INTO sync_log (sync_time, provider, success, items_processed, new_movies, new_series, updated_existing, error_message)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      `).bind(
        syncTime,
        provider,
        r.failed ? 0 : 1,
        r.itemsProcessed || 0,
        r.newMovies || 0,
        r.newSeries || 0,
        r.updatedExisting || 0,
        r.error || null
      ).run();
    } catch (logErr) {
      console.error(`[PRAFLIX Sync] sync_log write failed for ${provider}: ${logErr.message}`);
    }
  }
  let totalMovies = 0, totalSeries = 0, totalUpdated = 0;
  for (const p of PROVIDERS) {
    const r = providerResults[p];
    if (!r.failed) {
      totalMovies += r.newMovies || 0;
      totalSeries += r.newSeries || 0;
      totalUpdated += r.updatedExisting || 0;
    }
  }
  const allFailed = PROVIDERS.every((p) => providerResults[p].failed);
  return {
    syncTime,
    providerResults,
    totals: {
      moviesAdded: totalMovies,
      seriesAdded: totalSeries,
      totalTitlesAdded: totalMovies + totalSeries,
      titlesUpdated: totalUpdated
    },
    allFailed
  };
}
__name(runFullD1Sync, "runFullD1Sync");
function formatTelegramReport(summary) {
  const dt = new Date(summary.syncTime);
  const pad = /* @__PURE__ */ __name((n) => String(n).padStart(2, "0"), "pad");
  const formatted = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())} UTC`;
  let text = "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
  text += "       PRAFLIX REPORT\n";
  text += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n";
  text += "\u{1F4C5} DAILY CATALOG UPDATE\n";
  text += `\u{1F550} Sync completed: ${formatted}

`;
  for (const prov of PROVIDERS) {
    const res = summary.providerResults[prov];
    text += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
    text += `${prov.toUpperCase()}
`;
    text += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n";
    if (!res || res.failed) {
      text += "\u26A0\uFE0F Sync failed\n";
      if (res && res.error) text += `Error: ${res.error}
`;
      text += "\u{1F3AC} New Movies: \u2014\n\u{1F4FA} New Series: \u2014\n\n";
    } else {
      text += `\u{1F3AC} New Movies: ${res.newMovies}
`;
      text += `\u{1F4FA} New Series: ${res.newSeries}

`;
    }
  }
  const t = summary.totals || { moviesAdded: 0, seriesAdded: 0, totalTitlesAdded: 0 };
  text += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
  text += "TOTAL\n";
  text += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n";
  text += `\u{1F3AC} Movies Added: ${t.moviesAdded}
`;
  text += `\u{1F4FA} Series Added: ${t.seriesAdded}
`;
  text += `\u{1F4E6} Total Added:  ${t.totalTitlesAdded}

`;
  if (summary.allFailed) {
    text += "\u{1F6A8} ALL PROVIDERS FAILED \u2014 catalog unchanged.";
  } else if (t.totalTitlesAdded > 0) {
    text += "\u2705 PRAFLIX CATALOG UPDATED (D1)";
  } else {
    text += "\u2705 No new titles found today.";
  }
  return text;
}
__name(formatTelegramReport, "formatTelegramReport");
async function sendTelegramReport(reportText, env) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHANNEL_ID || env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn("[PRAFLIX] Telegram credentials not set in Worker environment.");
    return { success: false, error: "Missing Worker credentials" };
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reportText, parse_mode: "HTML" })
    });
    const data = await resp.json();
    return { success: data.ok, result: data.result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
__name(sendTelegramReport, "sendTelegramReport");

// worker.js
var PAGE_SIZE_DEFAULT = 48;
var PAGE_SIZE_MAX = 100;
var CACHE_TTL_CATALOG = 3600;
var CACHE_TTL_TITLE = 86400;
var CACHE_TTL_META = 3600;
function jsonResponse(data, status = 200, cacheSeconds = 0) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (cacheSeconds > 0) {
    headers["Cache-Control"] = `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 7}`;
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return new Response(JSON.stringify(data), { status, headers });
}
__name(jsonResponse, "jsonResponse");
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status, 0);
}
__name(errorResponse, "errorResponse");
function buildCatalogWhere(params) {
  const conditions = ["status = 'active'"];
  const bindings = [];
  let idx = 1;
  if (params.year && /^\d{4}$/.test(params.year)) {
    conditions.push(`year = ?${idx++}`);
    bindings.push(params.year);
  }
  if (params.type && (params.type === "Movie" || params.type === "Web Series")) {
    conditions.push(`type = ?${idx++}`);
    bindings.push(params.type);
  }
  if (params.language) {
    conditions.push(`languages LIKE ?${idx++}`);
    bindings.push(`%${params.language}%`);
  }
  if (params.category) {
    const cat = params.category;
    if (cat === "Bollywood") {
      conditions.push(`(languages LIKE ?${idx++} AND languages NOT LIKE ?${idx++} AND languages NOT LIKE ?${idx++} AND languages NOT LIKE ?${idx++} AND languages NOT LIKE ?${idx++})`);
      bindings.push("%Hindi%", "%Telugu%", "%Tamil%", "%Malayalam%", "%English%");
    } else if (cat === "South Indian") {
      conditions.push(`(languages LIKE ?${idx++} OR languages LIKE ?${idx++} OR languages LIKE ?${idx++} OR languages LIKE ?${idx++})`);
      bindings.push("%Telugu%", "%Tamil%", "%Malayalam%", "%Kannada%");
    } else if (cat === "Hollywood") {
      conditions.push(`languages LIKE ?${idx++}`);
      bindings.push("%English%");
    }
  }
  if (params.platform) {
    const plat = params.platform;
    if (plat === "Prime Video" || plat === "Prime" || plat === "Amazon Prime") {
      conditions.push(`(platforms LIKE ?${idx++} OR platforms LIKE ?${idx++} OR platform LIKE ?${idx++})`);
      bindings.push("%Prime%", "%Amazon%", "%Prime%");
    } else {
      conditions.push(`(platforms LIKE ?${idx++} OR platform LIKE ?${idx++})`);
      bindings.push(`%${plat}%`, `%${plat}%`);
    }
  }
  if (params.q && params.q.trim().length > 0) {
    const q = params.q.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (q.length > 0) {
      conditions.push(`(normalized_title LIKE ?${idx++} OR display_title LIKE ?${idx++})`);
      bindings.push(`%${q}%`, `%${params.q.trim()}%`);
    }
  }
  return {
    where: conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "",
    bindings
  };
}
__name(buildCatalogWhere, "buildCatalogWhere");
function buildOrderBy(sort) {
  switch (sort) {
    case "year-asc":
      return "ORDER BY CAST(year AS INTEGER) ASC, display_title ASC";
    case "title-asc":
      return "ORDER BY display_title ASC";
    case "title-desc":
      return "ORDER BY display_title DESC";
    case "year-desc":
    default:
      return "ORDER BY CAST(year AS INTEGER) DESC, display_title ASC";
  }
}
__name(buildOrderBy, "buildOrderBy");
function marshalCatalogRow(row) {
  const parse = /* @__PURE__ */ __name((v) => {
    if (!v) return [];
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }, "parse");
  return {
    canonicalId: row.canonical_id,
    id: row.id,
    displayTitle: row.display_title,
    originalSourceTitle: row.original_source_title || "",
    normalizedTitle: row.normalized_title,
    year: row.year || "",
    type: row.type,
    season: row.season || null,
    episodeStatus: row.episode_status || null,
    status: row.status,
    genres: parse(row.genres),
    languages: parse(row.languages),
    audioTracks: parse(row.audio_tracks),
    audio: row.audio || "",
    platform: row.platform || null,
    platforms: parse(row.platforms),
    releaseType: row.release_type || "",
    poster: row.poster || "assets/posters/fallback.svg",
    sourcePosterUrl: row.source_poster_url || null,
    qualities: parse(row.qualities),
    variantCount: row.variant_count || 1,
    // variants and screenshots are loaded separately for detail view
    variants: [],
    screenshots: []
  };
}
__name(marshalCatalogRow, "marshalCatalogRow");
async function loadVariants(db, canonicalId) {
  const result = await db.prepare(
    "SELECT * FROM variants WHERE canonical_id = ?1 ORDER BY id ASC"
  ).bind(canonicalId).all();
  return (result.results || []).map((v) => ({
    source: v.source,
    sourceUrl: v.source_url,
    originalSourceTitle: v.original_source_title,
    poster: v.poster,
    qualities: (() => {
      try {
        return JSON.parse(v.qualities || "[]");
      } catch {
        return [];
      }
    })(),
    releaseType: v.release_type,
    audio: v.audio,
    languages: (() => {
      try {
        return JSON.parse(v.languages || "[]");
      } catch {
        return [];
      }
    })(),
    platform: v.platform
  }));
}
__name(loadVariants, "loadVariants");
async function loadScreenshots(db, canonicalId) {
  const result = await db.prepare(
    "SELECT * FROM screenshots WHERE canonical_id = ?1 ORDER BY id ASC"
  ).bind(canonicalId).all();
  return (result.results || []).map((s) => ({
    url: s.url,
    source: s.source,
    provider: s.provider,
    caption: s.caption
  }));
}
__name(loadScreenshots, "loadScreenshots");
function handleHealth(env) {
  return jsonResponse({
    status: "ok",
    service: "PRAFLIX",
    db: env.DB ? "D1 connected" : "D1 not bound",
    version: "2.0-d1"
  });
}
__name(handleHealth, "handleHealth");
async function handleMeta(db) {
  const [titleCount, yearRows, typeRows, screenshotCount] = await Promise.all([
    db.prepare("SELECT COUNT(*) as cnt FROM canonical_titles WHERE status='active'").first(),
    db.prepare("SELECT year, COUNT(*) as cnt FROM canonical_titles WHERE status='active' AND year IS NOT NULL AND year != '' GROUP BY year ORDER BY CAST(year AS INTEGER) DESC").all(),
    db.prepare("SELECT type, COUNT(*) as cnt FROM canonical_titles WHERE status='active' GROUP BY type").all(),
    db.prepare("SELECT COUNT(*) as cnt FROM screenshots").first()
  ]);
  const years = (yearRows.results || []).map((r) => r.year);
  const typeCounts = {};
  (typeRows.results || []).forEach((r) => {
    typeCounts[r.type] = r.cnt;
  });
  return jsonResponse({
    totalTitles: titleCount ? titleCount.cnt : 0,
    totalScreenshots: screenshotCount ? screenshotCount.cnt : 0,
    years,
    typeCounts,
    providers: ["HDHub4u", "10Moviez", "HDWall"]
  }, 200, CACHE_TTL_META);
}
__name(handleMeta, "handleMeta");
async function handleCatalog(db, url) {
  const params = url.searchParams;
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(params.get("limit") || String(PAGE_SIZE_DEFAULT), 10)));
  const sort = params.get("sort") || "year-desc";
  const year = params.get("year") || "";
  const type = params.get("type") || "";
  const category = params.get("category") || "";
  const platform = params.get("platform") || "";
  const language = params.get("language") || "";
  const q = params.get("q") || "";
  const { where, bindings } = buildCatalogWhere({ year, type, category, platform, language, q });
  const orderBy = buildOrderBy(sort);
  const offset = (page - 1) * limit;
  const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM canonical_titles ${where}`);
  const dataStmt = db.prepare(`SELECT * FROM canonical_titles ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`);
  let countBound = countStmt;
  let dataBound = dataStmt;
  bindings.forEach((val, i) => {
    countBound = countBound.bind ? countBound : countStmt;
    dataBound = dataBound.bind ? dataBound : dataStmt;
  });
  const [countResult, dataResult] = await Promise.all([
    bindings.length > 0 ? db.prepare(`SELECT COUNT(*) as cnt FROM canonical_titles ${where}`).bind(...bindings).first() : db.prepare(`SELECT COUNT(*) as cnt FROM canonical_titles ${where}`).first(),
    bindings.length > 0 ? db.prepare(`SELECT * FROM canonical_titles ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`).bind(...bindings).all() : db.prepare(`SELECT * FROM canonical_titles ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`).all()
  ]);
  const total = countResult ? countResult.cnt : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const records = (dataResult.results || []).map(marshalCatalogRow);
  return jsonResponse({
    total,
    page,
    limit,
    totalPages,
    sort,
    records
  }, 200, q ? 0 : CACHE_TTL_CATALOG);
}
__name(handleCatalog, "handleCatalog");
async function handleTitle(db, canonicalId) {
  const id = parseInt(canonicalId, 10);
  if (isNaN(id) || id < 1) return errorResponse("Invalid title ID", 400);
  const row = await db.prepare(
    "SELECT * FROM canonical_titles WHERE canonical_id = ?1 AND status = 'active'"
  ).bind(id).first();
  if (!row) return errorResponse("Title not found", 404);
  const record = marshalCatalogRow(row);
  const [variants, screenshots] = await Promise.all([
    loadVariants(db, id),
    loadScreenshots(db, id)
  ]);
  record.variants = variants;
  record.screenshots = screenshots;
  const related = await db.prepare(
    "SELECT canonical_id, id, display_title, year, type, poster FROM canonical_titles WHERE type = ?1 AND year = ?2 AND canonical_id != ?3 AND status = 'active' ORDER BY RANDOM() LIMIT 6"
  ).bind(row.type, row.year || "", id).all();
  record.relatedTitles = (related.results || []).map((r) => ({
    canonicalId: r.canonical_id,
    id: r.id,
    displayTitle: r.display_title,
    year: r.year,
    type: r.type,
    poster: r.poster || "assets/posters/fallback.svg"
  }));
  return jsonResponse(record, 200, CACHE_TTL_TITLE);
}
__name(handleTitle, "handleTitle");
async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  if (request.method !== "GET" && !url.pathname.startsWith("/api/")) {
  }
  const path = url.pathname;
  if (path === "/api/health") {
    return handleHealth(env);
  }
  if (path === "/api/meta") {
    if (!env.DB) return errorResponse("D1 database not bound", 503);
    return handleMeta(env.DB);
  }
  if (path === "/api/catalog" || path === "/api/search") {
    if (!env.DB) return errorResponse("D1 database not bound", 503);
    return handleCatalog(env.DB, url);
  }
  if (path.startsWith("/api/title/")) {
    if (!env.DB) return errorResponse("D1 database not bound", 503);
    const idStr = path.replace("/api/title/", "").split("/")[0];
    return handleTitle(env.DB, idStr);
  }
  if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
    return env.ASSETS.fetch(request);
  }
  return new Response("PRAFLIX Static Assets Not Bound", { status: 500 });
}
__name(handleRequest, "handleRequest");
async function handleScheduledSync(env) {
  if (!env.DB) {
    console.error("[PRAFLIX Cron] D1 DB binding missing \u2014 cannot sync");
    return;
  }
  console.log("[PRAFLIX Cron] Starting 24-hour catalog sync...");
  let summary;
  try {
    summary = await runFullD1Sync(env.DB);
  } catch (syncErr) {
    console.error("[PRAFLIX Cron] runFullD1Sync threw:", syncErr.message);
    try {
      await sendTelegramReport(
        `\u{1F6A8} PRAFLIX CRON ERROR

Sync engine threw an unhandled error:
${syncErr.message}

Catalog unchanged.`,
        env
      );
    } catch (_) {
    }
    return;
  }
  const reportText = formatTelegramReport(summary);
  console.log("[PRAFLIX Cron] Sync complete. Report:\n" + reportText);
  const tgResult = await sendTelegramReport(reportText, env);
  if (tgResult.success) {
    console.log("[PRAFLIX Cron] Telegram report delivered successfully.");
  } else {
    console.warn("[PRAFLIX Cron] Telegram delivery issue:", tgResult.error);
  }
}
__name(handleScheduledSync, "handleScheduledSync");
var worker_default = {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledSync(env));
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
