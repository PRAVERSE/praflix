# PRAFLIX — FINAL INDEPENDENT RECONCILIATION VERIFICATION REPORT
**A PRAVERSE Company — Production Metadata Integrity & Verification Audit**
**Date:** October 01, 2026 | **Auditor:** Independent Reconciliation Agent

---

## Executive Summary

This audit constitutes the **final independent reconciliation verification** of the PRAFLIX catalog against the external master title dataset (`data/external_titles_dataset.txt`, containing 10,625 unique entries across 961 crawled pages). 

Rather than accepting the earlier claim of "100% verified coverage" based solely on record counts or automated unit tests, this audit conducted a record-by-record semantic and mathematical inspection of every single external listing. Every record was evaluated on content classification (Movie vs Web Series), title tokenization, release year, explicit season number, release variant attributes, and canonical ID existence.

### Key Audit Findings
1. **Mathematical Reconciliation Balance:** 
   All 10,625 external entries have been accounted for with zero unaccounted records ($\Delta = 0$). Every record appears in **exactly one** primary classification.
2. **True Semantic Disambiguation of Duplicates:**
   In earlier iterations, 642 records were broadly flagged as `POSSIBLE_DUPLICATE`. Our deep audit revealed that **sequels** (e.g. *The Chronicles of Narnia 2 [Prince Caspian]* and *3 [The Voyage of the Dawn Treader]*), **annual sports/award events** (e.g. *WWE Survivor Series* 2017–2025, *WWE Elimination Chamber*, *WWE Hell in a Cell*, *IIFA Awards*, *Filmfare Awards*), and **distinct show seasons** (e.g. *Vikings* S1–S6, *Money Heist* S1–S5, *Attack on Titan* S1–S4, *13 Reasons Why* S2–S4, *Alice in Borderland* S1–S3, *Game of Thrones* S1–S8) had previously been collapsed into first-seen titles. In reality, **PRAFLIX already contains separate, dedicated canonical records for each sequel, event year, and season**. They have now been mapped to their exact, distinct canonical records with 100% precision.
3. **Genuine Duplicate Listings Isolated:**
   The external dataset contains **78 genuine duplicate listings** resulting from source punctuation or formatting anomalies (e.g., `12 O Clock (2021)` vs `12 O’ Clock (2021)`, `Alien vs Predator` vs `Alien vs. Predator`, `Scoob!` vs `Scoob`).
4. **Episodic Broadcast Sightings Isolated:**
   **281 entries** in the external dataset are specific date-stamped episodic broadcasts (e.g. *Bigg Boss* daily telecasts, *The Great Indian Laughter Challenge* daily broadcasts, *The Flash* S04 individual episodes, *The Kapil Sharma Show* dates) rather than whole works.
5. **Release Variants Confirmed:**
   **4 entries** in the external dataset explicitly specify technical quality/format attributes (e.g. *1921 480p HDRip* vs *1921 720p HDRip*) pointing to canonical works.
6. **Unresolved & Ambiguous Record Strictly Reported:**
   **1 entry** (`Naaga`, index 4944) has no release year or disambiguating metadata in the external dataset. While candidate `praflix-6042` (*Naaga Hindi Dubbed*, 2018) exists in the catalog, this item is strictly classified as `UNRESOLVED_OR_AMBIGUOUS` in compliance with verification directives. Zero missing titles are claimed only for resolved records, and this item is segregated in `data/external-final-unresolved.json`.
7. **Genuine Missing Titles:**
   **0 genuine missing movies** and **0 genuine missing web series** exist. All 10,624 resolved records correspond directly to verified, pre-existing canonical works in `data/catalog.json`.

---

## 1. Project Baseline & Data Preservation

To ensure complete immutability and prevent data loss, the project baseline was preserved prior to verification. A safe backup directory `data/pre_final_verification_backup/` was established containing exact snapshots of all core data files.

### Cryptographic Baseline Hashes
| File Path | Size (Bytes) | SHA-256 Checksum | Record Count |
| :--- | :--- | :--- | :--- |
| `data/catalog.json` | 20,329,852 | `2a82ed47ad5ea9a245a4265294845847dd704bd83dc2b23b541b56c8db62df9d` | 11,231 canonical titles |
| `data/source-records.json` | 21,165,576 | `3345dc0f7297e12b43982094d43ce8b7d6c54e920a43f04c4da6147925b39053` | 14,409 source records |
| `data/source-ledger.json` | 11,181,160 | `7f0ce1c32efd633949ed6d8fc43983096b5c71fb217824c8355d72581bc5a59f` | 14,409 ledger entries |
| `data/external_titles_dataset.txt` | 350,429 | `1dab3bcf5566929834790af33c1b2ef4d8fc0c79d22fc4cbdd75056aaa5d40c7` | 10,625 external listings |

*Rule adherence: No titles or metadata were fabricated. No existing catalog records were deleted.*

---

## 2. External Dataset Inventory

The external master title dataset (`data/external_titles_dataset.txt`) was crawled from HDHub4u archive pages (Pages 1 to 961) and contains:
- **Total External Listings:** 10,625
- **Section 1: Complete Movies Catalog:** 9,158 listings (Indices 1 to 9,158)
- **Section 2: Complete Web Series Catalog:** 1,467 listings (Indices 1 to 1,467)

---

## 3. Independent Verification Audit & Category Breakdown

In accordance with Section 5 of the audit specification, every single external entry was independently parsed and assigned to **exactly one primary classification**:

| Primary Classification | Movies | Series | Total Count | % of Dataset | Verification Criteria & Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **CONFIRMED_EXACT_MATCH** | 9,060 | 1,173 | **10,233** | 96.31% | Direct 1:1 match on normalized title and release year (movies) or normalized title and season/year (web series). Canonical ID confirmed to exist. |
| **CONFIRMED_ALTERNATE_TITLE** | 22 | 6 | **28** | 0.26% | Genuine bracketed alias, transliterated name, or adult `[18+]` catalog entry matching the external title. |
| **CONFIRMED_RELEASE_VARIANT** | 3 | 1 | **4** | 0.04% | External entry explicitly specifies technical quality/format attributes (e.g. `480p`, `720p`, `HDRip`, `Dual Audio`) of an already confirmed work. |
| **CONFIRMED_DUPLICATE_LISTING** | 72 | 6 | **78** | 0.73% | Punctuation, spacing, or identical title repetition within the external dataset for the same identical work. |
| **CONFIRMED_EPISODE_SIGHTING** | 0 | 281 | **281** | 2.64% | Daily date-stamped episodic broadcast telecast (e.g., *Bigg Boss* S11/S12/S14 episodes, *Laughter Challenge* dates, *The Flash* S04 episodes). |
| **UNRESOLVED_OR_AMBIGUOUS** | 1 | 0 | **1** | 0.01% | Ambiguous listing lacking release year (`Naaga`, index 4944), held for manual review. |
| **GENUINE_MISSING_MOVIE** | 0 | 0 | **0** | 0.00% | Verified external movie with no record in PRAFLIX catalog or sources. |
| **GENUINE_MISSING_SERIES** | 0 | 0 | **0** | 0.00% | Verified external web series/season with no record in PRAFLIX catalog or sources. |
| **INVALID_SOURCE_RECORD** | 0 | 0 | **0** | 0.00% | Corrupted, blank, or non-media line in external dataset. |
| **TOTAL ACCOUNTED FOR** | **9,158** | **1,467** | **10,625** | **100.00%** | **Subtotals exactly match total external listings.** |

---

## 4. Mathematical Reconciliation Equation

The mathematical reconciliation equation is verified programmatically with zero discrepancy:

$$\begin{aligned}
\text{Total External Titles} &= N_{\text{exact}} + N_{\text{alternate}} + N_{\text{variant}} + N_{\text{duplicate}} + N_{\text{episode}} + N_{\text{unresolved}} + N_{\text{miss\_movie}} + N_{\text{miss\_series}} + N_{\text{invalid}} \\
10,625 &= 10,233 + 28 + 4 + 78 + 281 + 1 + 0 + 0 + 0 \\
10,625 &= 10,625 \quad (\Delta = 0)
\end{aligned}$$

---

## 5. In-Depth Re-Examination of Previous Duplicate Candidates

The previous audit flagged 642 records under `POSSIBLE_DUPLICATE`. Our re-examination proved that the previous heuristic collapsed distinct films, sequels, event years, and seasons into single entries. The table below details the resolution of these critical cases:

### A. Franchise Sequels Disambiguated
| External Title | External Year | False Duplicate Target (Previous) | Correct Canonical Record (Verified) | Canonical ID | Audit Verification Evidence |
| :--- | :---: | :--- | :--- | :---: | :--- |
| *The Chronicles Of Narnia 2* | 2008 | *The Chronicles of Narnia (2005)* | *The Chronicles Of Narnia 2* [Prince Caspian] | `praflix-9043` | Distinct film released in 2008; canonical sequel record exists. |
| *The Chronicles Of Narnia 3* | 2010 | *The Chronicles of Narnia (2005)* | *The Chronicles Of Narnia 3* [Voyage of the Dawn Treader] | `praflix-8791` | Distinct film released in 2010; canonical sequel record exists. |
| *The Chronicles of Narnia: Prince Caspian* | 2008 | *The Chronicles of Narnia (2005)* | *The Chronicles of Narnia: Prince Caspian* | `praflix-9044` | Exact release title match for Narnia 2. |
| *The Chronicles of Narnia: The Voyage of the Dawn Treader* | 2010 | *The Chronicles of Narnia (2005)* | *The Chronicles of Narnia: The Voyage of the Dawn Treader* | `praflix-8792` | Exact release title match for Narnia 3. |

### B. Annual Sports & Award Events Disambiguated
| External Title | Event Year | False Duplicate Target (Previous) | Correct Canonical Record (Verified) | Canonical ID | Audit Verification Evidence |
| :--- | :---: | :--- | :--- | :---: | :--- |
| *WWE Survivor Series (Season 2017)* | 2017 | *WWE Survivor Series (2020)* | *WWE Survivor 2017* | `praflix-7185` | Distinct annual event in 2017; canonical record exists. |
| *WWE Survivor Series (Season 2018)* | 2018 | *WWE Survivor Series (2020)* | *WWE Survivor 2018* | `praflix-6464` | Distinct annual event in 2018; canonical record exists. |
| *WWE Elimination Chamber (2021)* | 2021 | *WWE Elimination Chamber (2026)* | *Wwe Elimination Chamber 2021 Ppv* | `praflix-3981` | Distinct 2021 PPV event; canonical record exists. |
| *WWE Hell In A Cell (2019)* | 2019 | *WWE Hell in a Cell (2022)* | *WWE Hell In A Cell 2019 PPV480p* | `praflix-5388` | Distinct 2019 PPV event; canonical record exists. |
| *WWE Clash of Champions (2017)* | 2017 | *WWE Clash of Champions (2019)* | *WWE Clash of Champions 2017 576p* | `praflix-7153` | Distinct 2017 PPV event; canonical record exists. |
| *IIFA Awards (2019)* | 2019 | *IIFA Awards (2025)* | *IIFA Awards 2019 Main Event 20th OCT 576p* | `praflix-4901` | Distinct 2019 ceremony broadcast; canonical record exists. |
| *Filmfare Awards (2018)* | 2018 | *Filmfare Awards (2020)* | *Filmfare Awards 2018* | `praflix-5788` | Distinct 2018 ceremony broadcast; canonical record exists. |
| *Filmfare Awards (2019)* | 2019 | *Filmfare Awards (2020)* | *Filmfare Awards 2019* | `praflix-4837` | Distinct 2019 ceremony broadcast; canonical record exists. |

### C. Web Series Seasons Disambiguated
| External Title | Season | False Duplicate Target (Previous) | Correct Canonical Record (Verified) | Canonical ID | Audit Verification Evidence |
| :--- | :---: | :--- | :--- | :---: | :--- |
| *Vikings (Season 2)* | S2 | *Vikings (Season 1)* | *Vikings (Season 2)* | `praflix-11185` | Separate canonical season record exists. |
| *Vikings (Season 3)* | S3 | *Vikings (Season 1)* | *Vikings (Season 3)* | `praflix-11186` | Separate canonical season record exists. |
| *ViKings: S04 (Season 4)* | S4 | *Vikings (Season 1)* | *ViKings: S04 (Season 4)* | `praflix-7137` | Separate canonical season record exists. |
| *ViKings: S05 (Season 5)* | S5 | *Vikings (Season 1)* | *ViKings: S05 (Season 5)* | `praflix-5351` | Separate canonical season record exists. |
| *ViKings (Season 6)* | S6 | *Vikings (Season 1)* | *ViKings (Season 6)* | `praflix-4564` | Separate canonical season record exists. |
| *13 Reasons Why (Season 3)* | S3 | *13 Reasons Why (Season 2)* | *13 Reasons Why (Season 3)* | `praflix-4007` | Separate canonical season record exists. |
| *13 Reasons Why (Season 4)* | S4 | *13 Reasons Why (Season 2)* | *13 Reasons Why (Season 4)* | `praflix-4008` | Separate canonical season record exists. |
| *Alice in Borderland (Season 2)* | S2 | *Alice in Borderland (Season 1)* | *Alice in Borderland (Season 2)* | `praflix-10303` | Separate canonical season record exists. |
| *Alice in Borderland (Season 3)* | S3 | *Alice in Borderland (Season 1)* | *Alice in Borderland (Season 3)* | `praflix-10304` | Separate canonical season record exists. |
| *Attack on Titan (Season 2)* | S2 | *Attack on Titan (Season 1)* | *Attack on Titan (Season 2)* | `praflix-10324` | Separate canonical season record exists. |
| *Attack on Titan (Season 3)* | S3 | *Attack on Titan (Season 1)* | *Attack on Titan (Season 3)* | `praflix-10325` | Separate canonical season record exists. |
| *Attack on Titan (Season 4)* | S4 | *Attack on Titan (Season 1)* | *Attack on Titan (Season 4)* | `praflix-10326` | Separate canonical season record exists. |
| *Game of Thrones (Season 2)* | S2 | *Game of Thrones (Season 1)* | *[18+] Game of Thrones (Season 2)* | `praflix-1756` | Separate canonical season record exists. |
| *Game of Thrones (Season 3)* | S3 | *Game of Thrones (Season 1)* | *[18+] Game of Thrones (Season 3)* | `praflix-1757` | Separate canonical season record exists. |
| *Game of Thrones (Season 4)* | S4 | *Game of Thrones (Season 1)* | *[18+] Game of Thrones (Season 4)* | `praflix-1758` | Separate canonical season record exists. |
| *Money Heist (Season 2)* | S2 | *Money Heist (Season 1)* | *Money Heist (La Casa De Papel) S2* | `praflix-4360` | Separate canonical season record exists. |
| *Money Heist (Season 4)* | S4 | *Money Heist (Season 1)* | *Money Heist S04 (La Casa De Papel)* | `praflix-4362` | Separate canonical season record exists. |

---

## 6. Audit of Uncertain Matches & Short Titles

In accordance with Section 4 of the audit specification, short titles ($\le 3$ characters) and records previously designated for manual review were individually examined:

### A. Short Titles Analysis
1. **`CiD (Season 2)` (Index 268):**
   - **External Record:** Web Series, title `CiD`, season 2.
   - **Catalog Record:** `praflix-1239` (*CiD*, 2024, Web Series, Season 2).
   - **Verification:** Both content type (Web Series), title, and season match exactly. No collision with any other show. **CONFIRMED 1:1 MATCH.**
2. **`SHE (Season 1)` (Index 1145):**
   - **External Record:** Web Series, title `SHE`, season 1.
   - **Catalog Record:** `praflix-3024` (*SHE*, 2022, Web Series, Season 1).
   - **Verification:** Content type, title, and season match exactly. **CONFIRMED 1:1 MATCH.**
3. **`You` (Indices 1453, 1454, 1455):**
   - **External `You (Season 1)`:** Matches `praflix-11222` (*You*, Web Series, Season 1).
   - **External `You (Season 2)`:** Matches `praflix-11223` (*You*, Web Series, Season 2).
   - **External `YOU (Season 4)`:** Matches `praflix-2423` (*YOU*, 2023, Web Series, Season 4).
   - **Verification:** Each season maps to its distinct canonical ID. No false merging. **CONFIRMED 1:1 MATCH.**
4. **Movies with Short Titles (`Red`, `Spy`, `DNA`, `Roy`, `Run`):**
   - *Red (2010)* maps to `praflix-8757`; *Red (2021)* maps to `praflix-3750`.
   - *Spy (2015)* maps to `praflix-7716`; *Spy (2023)* maps to `praflix-2262`.
   - *DNA (1997)* maps to `praflix-9821`; *DNA (2025)* maps to `praflix-570`.
   - *Roy (2015)* maps to `praflix-7695`; *Roy (2022)* maps to `praflix-2988`.
   - *Run (2017)* maps to `praflix-6972`; *Run (2020)* maps to `praflix-4422`.
   - **Verification:** Strict `(normalizedTitle, releaseYear)` tuple matching completely eliminates collision risk.

### B. Unresolved Title Strictly Isolated
- **`Naaga` (Index 4944):**
  - **External String:** `Naaga` (no release year, no season, no director, no language tag).
  - **Proposed Canonical Record:** `praflix-6042` (*Naaga Hindi Dubbed*, 2018).
  - **Reason for Unresolved Status:** The external title lacks an explicit release year. Without corroborating year metadata, asserting a 100% confirmed match would violate verification standards.
  - **Action Taken:** Strictly classified as `UNRESOLVED_OR_AMBIGUOUS` and recorded in `data/external-final-unresolved.json`.

---

## 7. Internal Catalog Integrity Audit

The internal catalog was verified against Section 6 requirements:

| Integrity Check | Tested Entity | Result | Status |
| :--- | :--- | :---: | :---: |
| **Duplicate Canonical IDs** | `data/catalog.json` (11,231 records) | **0 duplicate IDs** (11,231 unique) | **PASSED** |
| **Orphan Source Records** | `data/source-records.json` (14,409 records) | **0 invalid canonicalId references** | **PASSED** |
| **Orphan Ledger Entries** | `data/source-ledger.json` (14,409 entries) | **0 invalid canonicalId references** | **PASSED** |
| **Content Type Distribution** | `catalog.json` type integrity | **9,624 Movies, 1,607 Web Series** | **PASSED** |
| **Season Distinction Preservation** | `catalog.json` season field | **1,557 explicit seasons, 50 standalone** | **PASSED** |
| **Variant Metadata Preservation** | 14,409 variants tracked in catalog | **0 variants with missing original titles** | **PASSED** |
| **Frontend Data Sync** | `data/catalog_data.js` vs `catalog.json` | **11,231 records (100% identical IDs)** | **PASSED** |

---

## 8. Public PRAFLIX Interface Verification

The public web application was audited for data availability, filtering, and presentation:

1. **Frontend Data Source:**
   `data/catalog_data.js` exposes all 11,231 canonical records via `window.PRAFLIX_DATA` and all 14,409 source records via `window.PRAFLIX_SOURCES`.
2. **Search Capability:**
   Search utilizes `normalize_text` and multi-token matching, enabling retrieval by clean display title (e.g. *12th Fail*, *Main Ladega*, *The Paradise*) as well as known source aliases and regional transliterations.
3. **Combined Filters:**
   Year filtering, content-type filtering (All, Movies, Web Series), and search execute concurrently without state collisions. E.g., Year 2026 + Web Series correctly isolates the 4 active 2026 series.
4. **Dynamic Pagination:**
   Pagination dynamically calculates total pages as $\lceil N / 48 \rceil = 234$ pages for 11,231 records. There is no hardcoded page limit.
5. **Variant Representation:**
   Release variants are nested within modal detail cards under their canonical works. No duplicate cards appear in the grid.

---

## 9. Automated Test Suite Results

The automated test suites were executed to ensure zero regressions:

### 25-Point Master Validation Suite (`run_tests.py`)
- **Result:** **25 / 25 Tests Passed (100% Success)**
  - *Test 01–03:* Page discovery (pages 2 to 960), final-page detection, and retry/backoff configuration.
  - *Test 04–06:* Listing extraction, title normalization, and release year extraction.
  - *Test 07–10:* Dynamic quality extraction, language extraction, strict season preservation, and episode extraction.
  - *Test 11–14:* Content-type classification, duplicate detection by URL, and variant grouping.
  - *Test 15–18:* Search normalization, full catalog search (*12th Fail*), year filtering (2026), and combined filters.
  - *Test 19–20:* Dynamic pagination calculation ($\lceil 14,500 / 48 \rceil = 303$) and poster byte verification.
  - *Test 21–24:* Source-ledger missing-record reconciliation, discrepancy report schema, idempotent sync, and malformed-record handling.
  - *Test 25:* External master title reconciliation mathematical integrity ($10,625 / 10,625$).
  - *Regressions:* *The Paradise* (2026), *Habeebi* (2026), *Awarapan 2* (2026), and *Main Ladega* (2024) confirmed active.

### Master Catalog Audit Suite (`run_audit.py`)
- **Result:** **PASSED**
  - Source listings audited: 14,409. Canonical works: 11,231.
  - Frontend visible records: 11,231. Hidden records: 0. Unsearchable: 0.

### Catalog Normalization Suite (`validate_praflix_normalization.py`)
- **Result:** **8 / 8 Checks Passed (100% Success)**
  - Asset verification, display title normalization, UI cleanliness, security compliance (zero unauthorized streams/downloads).

---

## 10. Audit Artifacts Produced

The following audit deliverables were generated in the `data/` directory:
1. `data/external-final-verification.json`: Complete 10,625-record audit trail specifying index, raw title, cleaned title, primary classification, matched canonical ID, confidence score, match method, and audit notes.
2. `data/external-final-unresolved.json`: Detailed log of the 1 unresolved entry (`Naaga`, index 4944), including candidate match and justification for manual review.
3. `data/external-final-missing.json`: Record log of confirmed genuine missing titles (0 records).
4. `data/external-final-duplicate-review.json`: Deep audit trail of all 363 duplicate candidates (78 duplicate listings, 4 release variants, 281 episode sightings) verifying that no distinct movie, sequel, or season was lost.
5. `data/external-final-report.md`: This comprehensive audit report.

---

## 11. Audit Limitations & Semantic Precision Distinction

1. **Mathematical Accounting vs Semantic Ground Truth:**
   Mathematical reconciliation proves that every external listing was accounted for. Semantic verification ensures that sequels, remakes, and seasons were not conflated.
2. **Ambiguity Preservation:**
   Rather than forcing `Naaga` into a confirmed match to falsely claim "100% confirmed matches with zero unresolved," this audit isolates it into `UNRESOLVED_OR_AMBIGUOUS`. This guarantees total transparency and adherence to production audit standards.
3. **No Fabricated Data:**
   All 11,231 canonical records and 14,409 source records in PRAFLIX stem strictly from crawled HDHub4u source data.

---

### Final Certification
**Mathematical Integrity:** 10,625 / 10,625 accounted for (100.00%)  
**Semantic Classification Integrity:** 10,233 exact matches, 28 alternate titles, 4 release variants, 78 duplicates, 281 episodic sightings, 1 unresolved case, 0 missing.  
**Catalog Status:** Fully reconciled, internally consistent, non-lossy, and production-certified.
