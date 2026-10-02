# PRAFLIX — A PRAVERSE Company
### Enterprise Cinema & Web-Series Catalog Discovery Platform

PRAFLIX is a high-performance cinema and television catalog platform developed under **A PRAVERSE Company**. It indexes a dual-source verified master catalog spanning **HDHub4u** and **Vegamovies** — **30,143 total source records** grouped into **15,433 canonical titles** with complete source reconciliation, permanent All-Years navigation, resilient multi-token search, and verified poster artwork.

---

## 1. Quick Start Commands

All operations can be executed with single commands:

```bash
# 1. Run Development Server (Serves on http://localhost:8085/)
python run_dev.py

# 2. Run Comprehensive 26-Point Master Validation Test Suite
python run_tests.py

# 3. Run Vegamovies Integration Pytest Suite
python -m pytest tests/test_vegamovies_integration.py -v

# 4. Run Frontend All-Years Test Suite
node test_frontend_all_years.js

# 5. Run Details Experience Acceptance Suite
node test_details_experience.js

# 6. Run Full Catalog & Reconciliation Audit
python run_audit.py

# 7. Run Reconciliation Engine (Source Inventory vs Master Catalog)
python run_reconciliation.py

# 8. Run Poster Verification & Asset Audit
python run_poster_validation.py

# 9. Rebuild Master Catalog (Local Baseline)
python run_pipeline.py --skip-crawl

# 10. Refresh Source Inventory via Dynamic Web Crawler
python run_crawler.py

# 11. Run Vegamovies Precision Integration Pipeline
python run_vegamovies_integration.py
```

---

## 2. Master Catalog Metrics

### HDHub4u + Vegamovies (Merged & Fully Reconciled)

| Metric | Count | Details |
| :--- | :--- | :--- |
| **Total Source Records** | **30,143** | HDHub4u (14,409) + Vegamovies (15,734) in `data/source-records.json` |
| **Canonical Titles** | **15,433** | Deduplicated & normalized movies and series in `data/catalog.json` |
| **Feature Films (Movies)** | **13,446** | Cleanly classified feature films across both sources |
| **Web Series / TV Shows** | **1,987** | Television and OTT series with consolidated season variants |
| **Explicit Seasons Preserved** | **1,926** | Verbatim seasons (e.g. `Season 1`, `Season 2`) |
| **Vegamovies Variants Added** | **9,633** | Vegamovies releases merged into existing HDHub4u canonical entries |
| **New Vegamovies-Only Canonicals** | **4,202** | New titles from Vegamovies (3,822 Movies, 380 Web Series) |
| **Verified Remote Artwork** | **2,739** | Verified 200 OK WebP artwork from `vegamoviess.io` |
| **Locally Cached Posters** | **8,626** | Verified JPEG/PNG files stored in `assets/posters/` |
| **Procedural Fallback Posters** | **4,068** | Procedural SVG artwork assigned (`fallback.svg`) |
| **Reconciliation Missing Records** | **0** | 100% of discovered listings matched or grouped (0 dropped) |
| **Automated Test Pass Rate** | **100% (87/87)** | 26 Python + 10 Pytest + 24 Frontend + 27 Details Acceptance |
| **Math Integrity** | **PASSED** | `inputVegaRecords (15,734) == accounted (9,633 + 6,101 = 15,734)` |
| **Download / Video Endpoints** | **0** | Informational catalog discovery only |

### HDHub4u Only (Pre-Integration Baseline)

| Metric | Count |
| :--- | :--- |
| Source Records | 14,409 |
| Canonical Titles | 11,231 |
| Movies | 9,624 |
| Web Series | 1,607 |

---

## 3. Architecture & Data Flow

```text
SOURCE ARCHIVE (960+ Pages, Sitemaps, Categories)
                      ↓
DYNAMIC PAGE DISCOVERY (crawler/discovery.py)
                      ↓
RESILIENT ASYNC FETCHER (crawler/fetcher.py with Disk Caching)
                      ↓
MASTER SOURCE INVENTORY (crawler/inventory.py → data/source-inventory.json)
                      ↓
TITLE & METADATA NORMALIZATION (crawler/parser.py & normalizer.py)
                      ↓
CANONICAL MATCHING & VARIANT GROUPING (crawler/matcher.py)
                      ↓
MISSING-TITLE RECONCILIATION (crawler/reconciliation.py)
                      ↓
IDEMPOTENT SYNCHRONIZATION (crawler/sync.py → data/sync-state.json)
                      ↓
MASTER CATALOG EXPORTS (JSON, CSV, JS for zero-latency UI)
                      ↓
CINEMA DISCOVERY UI (index.html, styles.css, app.js)
```

---

## 4. Key Architectural Features

1. **Dynamic Page Discovery (No Hardcoded Pages)**:
   - Evaluates pagination navigation links to discover current final archive page (`960` today, `961+` tomorrow).
   - Never stops at arbitrary limits.

2. **Clean Display Titles & Non-Destructive Preservation**:
   - `displayTitle` contains the clean movie/series title without technical tags (e.g. *The Paradise*, *12th Fail*, *Main Ladega*, *Awarapan 2*).
   - Full original text is preserved in `originalSourceTitle`.
   - Meaningful numbers that are part of the title (e.g. *Awarapan 2*, *Scary Movie 4*) are never removed.

3. **Multi-Token Normalized Search Across Full Catalog**:
   - Resilient against casing, punctuation, hyphens, and whitespace.
   - Searches across `displayTitle`, `normalizedTitle`, `year`, `season`, `languages`, `qualities`, `platforms`, and all release variants.
   - Searching `THE PARADISE`, `The Paradise`, `the paradise`, `The-Paradise`, `Paradise 2026`, or `The Paradise Hindi` instantly locates the canonical record.
   - Searching older movies (e.g. *12th Fail*, *Main Ladega*) searches across the entire catalog and is not restricted by default year filters.

4. **Permanent All-Years Catalog Architecture**:
   - The catalog permanently and automatically displays all years by default without requiring year selection.
   - All 15,433 verified titles across all 83 release years are immediately available for browsing, sorting, and multi-token search.
   - Secondary filters (Content Type, Platform, Season, Language, Quality, and Sort Order) operate cleanly across the complete multi-year archive.

5. **Dynamic Pagination**:
   - Calculated dynamically as `Math.ceil(totalRecords / 48)`.
   - Adapts automatically as the catalog expands or contracts.

6. **Strict Season Integrity**:
   - Preserves explicit seasons verbatim (`Season 1`, `Season 2`).
   - Never manufactures `Season 1` if the source did not specify a season.

7. **Separation of Quality from Release Type**:
   - Resolutions (`4K`, `1080p`, `720p`, `480p`) are stored in dynamic arrays.
   - Release types (`WEB-DL`, `WEBRip`, `BluRay`, `HDTC`, `HQ-HDTC`) are separated into discrete fields.

8. **Missing-Title Reconciliation Engine**:
   - Compares 100% of discovered listings against the canonical catalog.
   - Produces `data/reconciliation-report.json` and `data/missing-records.json`.
   - Every missing listing receives an explicit reason code:
     `NOT_CRAWLED`, `EXTRACTION_FAILED`, `NORMALIZATION_FAILED`, `DUPLICATE`, `VARIANT_GROUPED`, `AMBIGUOUS_MATCH`, `INVALID_SOURCE_RECORD`, `POSTER_FAILURE`, `UI_FILTERED`, `SEARCH_INDEX_FAILURE`, `IMPORT_FAILURE`, `UNKNOWN`.

---

## 5. Project Directory Structure

```text
PRAM/
├── assets/
│   └── posters/                       # 8,627 verified local JPGs + fallback.svg
├── crawler/                           # Modular crawler and catalog engine
│   ├── __init__.py
│   ├── config.py                      # URLs, headers, paths, concurrency
│   ├── discovery.py                   # Dynamic archive, category, sitemap discovery
│   ├── fetcher.py                     # Resilient async fetcher with disk caching
│   ├── parser.py                      # Metadata, quality, season, and type parser
│   ├── normalizer.py                  # Search text and title normalizer
│   ├── matcher.py                     # Canonical grouping & variant matcher
│   ├── inventory.py                   # Master source inventory builder
│   ├── reconciliation.py              # Missing-title reconciliation engine
│   ├── poster.py                      # Poster byte verification & auditing
│   ├── sync.py                        # Idempotent sync tracker
│   └── pipeline.py                    # Master pipeline runner
├── data/
│   ├── catalog.json                   # Primary canonical JSON database (11,221 titles)
│   ├── catalog-normalized.json        # Canonical JSON database with embedded variants
│   ├── source-records.json            # 14,395 raw source listings with metadata
│   ├── source-inventory.json          # Master source inventory with sightings
│   ├── catalog_data.js                # Zero-latency script for double-click browsing
│   ├── catalog.csv                    # Tabular CSV export
│   ├── crawl-audit.json               # Page crawl accounting report
│   ├── reconciliation-report.json     # Reconciliation report
│   ├── missing-records.json           # Missing records list with reason codes
│   ├── poster-audit.json              # Poster verification audit report
│   ├── search-audit.json              # Search normalization audit report
│   └── sync-state.json                # Idempotent sync state
├── tests/
│   └── test_parser_samples.py         # Unit tests on regression samples
├── index.html                         # Responsive cinema catalog UI
├── styles.css                         # Dark cinema design system
├── app.js                             # Search, dynamic navigation, modal controller
├── run_dev.py                         # Local development HTTP server runner
├── run_crawler.py                     # Dynamic crawler runner
├── run_pipeline.py                    # Master pipeline CLI runner
├── run_reconciliation.py              # Reconciliation runner
├── run_poster_validation.py           # Poster audit runner
├── run_tests.py                       # 24-point automated validation test suite
├── run_audit.py                       # Final catalog audit runner
└── README.md                          # Project documentation
```

---

## 6. Data Schema

### Canonical Catalog Record (`data/catalog.json`)

```json
{
  "id": "praflix-1",
  "canonicalId": 1,
  "displayTitle": "The Paradise",
  "originalSourceTitle": "The Paradise (2026) HQ-HDTC [Hindi - Telugu] (LiNE) 1080p 720p & 480p Dual Audio [x264/HEVC] | Full Movie",
  "normalizedTitle": "the paradise",
  "year": "2026",
  "type": "Movie",
  "season": null,
  "episodeStatus": null,
  "genres": ["Cinema"],
  "languages": ["Hindi", "Telugu", "Tamil"],
  "audioTracks": ["LiNE"],
  "audio": "LiNE",
  "platform": null,
  "platforms": [],
  "releaseType": "HQ-HDTC",
  "poster": "assets/posters/the-paradise-2026.jpg",
  "sourcePosterUrl": "https://catimages.org/images/2026/09/24/The-Paradise-Poster.jpg",
  "qualities": ["480p", "720p", "1080p"],
  "variantCount": 2,
  "variants": [
    {
      "sourceId": 12411,
      "sourceUrl": "https://new1.hdhub4u.free/the-paradise-2026-hindi-line-hdtc-full-movie/",
      "originalSourceTitle": "The Paradise (2026) HQ-HDTC [Hindi - Telugu] (LiNE) 1080p 720p & 480p Dual Audio [x264/HEVC] | Full Movie",
      "languages": ["Hindi", "Telugu"],
      "qualities": [{"resolution": "480p", "label": "480p"}, {"resolution": "720p", "label": "720p"}, {"resolution": "1080p", "label": "1080p"}],
      "releaseType": "HQ-HDTC",
      "audio": "LiNE",
      "platform": null,
      "poster": "assets/posters/the-paradise-2026.jpg"
    },
    {
      "sourceId": 12412,
      "sourceUrl": "https://new1.hdhub4u.free/the-paradise-2026-tamil-line-hdtc-full-movie/",
      "originalSourceTitle": "The Paradise (2026) HQ-HDTC [Tamil] (LiNE) 1080p 720p & 480p [x264/HEVC] | Full Movie",
      "languages": ["Tamil"],
      "qualities": [{"resolution": "480p", "label": "480p"}, {"resolution": "720p", "label": "720p"}, {"resolution": "1080p", "label": "1080p"}],
      "releaseType": "HQ-HDTC",
      "audio": "LiNE",
      "platform": null,
      "poster": "assets/posters/the-paradise-2026.jpg"
    }
  ],
  "status": "active"
}
```

---

## 7. Troubleshooting

### Q: Why did search return "No Titles Found" for titles like *12th Fail* or *Main Ladega*?
**Root Cause**: Previously, the UI had hardcoded the active year filter to `2026`. When a user searched, the year filter was still active, filtering out any movie not from 2026.
**Fix**: `app.js` now searches across all years by default whenever a query is entered, while allowing explicit single-year filtering when requested.

### Q: Why did some TV series disappear when filtering by year?
**Root Cause**: Series titles without explicit year markers had `year: null` and were dumped at the very end of the catalog without matching any year filter.
**Fix**: Year extraction now cross-references detail URLs, poster upload timestamps, and preserves verified baseline dates. Series without years are browsable via the "Web Series" chip.

### Q: How do I rebuild everything from scratch?
Run:
```bash
python run_pipeline.py --skip-crawl
python run_tests.py
python run_audit.py
```

---

## 8. Compliance Statement

PRAFLIX is developed strictly as an informational catalog discovery engine. It does not provide movie downloads, torrents, magnet links, external download redirects, streaming movie players, or video hosting endpoints. All media entities represent database catalog entries only.
