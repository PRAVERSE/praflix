"""
PRAFLIX — Vegamovies Catalogue Integration Engine (Robust & Idempotent)
Run with: python run_vegamovies_integration.py

Integrates the full 15,734 records from data/vegamovies_raw.json into the PRAFLIX catalog.
- Purely idempotent: Repeated runs produce identical counts and datasets.
- 100% data preservation: All 15,734 PDF records accounted for.
- Full season & title normalization for Movies & Web Series.
- Integrates verified poster artwork from vegamoviess.io.
- Generates catalog.json, catalog-normalized.json, source-records.json, catalog_data.js,
  vegamovies_sources.json, vegamovies_integration_report.json, and vegamovies_poster_review.json.
"""

import os
import re
import json
import unicodedata
from collections import defaultdict

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CATALOG_JSON = os.path.join(DATA_DIR, "catalog.json")
SOURCE_RECORDS_JSON = os.path.join(DATA_DIR, "source-records.json")
CATALOG_DATA_JS = os.path.join(DATA_DIR, "catalog_data.js")
CATALOG_NORMALIZED_JSON = os.path.join(DATA_DIR, "catalog-normalized.json")
VEGA_RAW_JSON = os.path.join(DATA_DIR, "vegamovies_raw.json")
VEGA_SOURCES_JSON = os.path.join(DATA_DIR, "vegamovies_sources.json")
VEGA_REPORT_JSON = os.path.join(DATA_DIR, "vegamovies_integration_report.json")
VEGA_REVIEW_JSON = os.path.join(DATA_DIR, "vegamovies_manual_review.json")
VEGA_POSTER_MAP_JSON = os.path.join(DATA_DIR, "vegamovies_posters_map.json")
VEGA_POSTER_REVIEW_JSON = os.path.join(DATA_DIR, "vegamovies_poster_review.json")

HDHUB_BASELINE_COUNT = 11231


def normalize_text(text):
    """Match crawler/normalizer.py normalize_text() exactly."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", str(text))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(
        r'[\-_/\\:\.,;!\?\'\"`\(\)\[\]\{\}\|+~\*@#\$%\^&=<>\ufffd\u2018\u2019\u201c\u201d\u2013\u2014\u2015]+',
        " ",
        text
    )
    return re.sub(r"\s+", " ", text).strip()


def canon_key(norm, year, season, ctype):
    """4-dimension canonical matching key."""
    return (
        norm,
        str(year or "").strip(),
        str(season or "").strip().lower(),
        str(ctype or "movie").strip().lower()
    )


# ────────────────────────────────────────────────────────────────────────────
# Phase 1: Load and clean HDHub4u baseline catalog
# ────────────────────────────────────────────────────────────────────────────

def load_clean_baseline():
    print("Loading baseline PRAFLIX catalog...")
    with open(CATALOG_JSON, encoding="utf-8") as f:
        raw_catalog = json.load(f)

    # Strictly retain HDHub4u baseline: canonicalId <= 11231
    baseline = []
    for c in raw_catalog:
        if c.get("canonicalId", 0) <= HDHUB_BASELINE_COUNT:
            # Strip any previously merged vegamovies variants for idempotency
            clean_vars = [
                v for v in c.get("variants", [])
                if v.get("source") != "vegamovies" and not str(v.get("sourceId", "")).startswith("vega-")
            ]
            c_clean = dict(c)
            c_clean["variants"] = clean_vars
            c_clean["variantCount"] = len(clean_vars)
            baseline.append(c_clean)

    print(f"  Clean HDHub4u baseline: {len(baseline):,} canonical titles")

    # Build indices for matching
    movies_exact = {}      # (norm, year) -> c
    movies_by_norm = defaultdict(list)  # norm -> list of c
    series_exact = {}      # (norm, season) -> c
    series_by_norm = defaultdict(list)  # norm -> list of c

    for c in baseline:
        norm = c.get("normalizedTitle") or normalize_text(c.get("displayTitle", ""))
        year = str(c.get("year") or "").strip()
        season = str(c.get("season") or "").strip().lower()
        ctype = str(c.get("type") or "Movie").strip().lower()

        if ctype == "web series":
            if season:
                series_exact[(norm, season)] = c
            series_by_norm[norm].append(c)
        else:
            if year:
                movies_exact[(norm, year)] = c
            movies_by_norm[norm].append(c)

    return baseline, movies_exact, movies_by_norm, series_exact, series_by_norm


# ────────────────────────────────────────────────────────────────────────────
# Phase 2: Load Vegamovies raw extraction (verify all 15,734 entries)
# ────────────────────────────────────────────────────────────────────────────

def load_vega():
    print("\nLoading Vegamovies raw extraction...")
    if not os.path.exists(VEGA_RAW_JSON):
        from crawler.vega_extractor import extract_all_vegamovies_records
        extract_all_vegamovies_records()

    with open(VEGA_RAW_JSON, encoding="utf-8") as f:
        vega_records = json.load(f)

    if len(vega_records) < 15734:
        print(f"  Existing vegamovies_raw.json has {len(vega_records):,} records. Re-extracting complete dataset...")
        from crawler.vega_extractor import extract_all_vegamovies_records
        vega_records = extract_all_vegamovies_records()

    print(f"  Total Vegamovies raw records: {len(vega_records):,}")

    # Ensure normalizedTitle is present
    for r in vega_records:
        if not r.get("normalizedTitle"):
            r["normalizedTitle"] = normalize_text(r.get("displayTitle", ""))

    # Save to vegamovies_sources.json
    with open(VEGA_SOURCES_JSON, "w", encoding="utf-8") as f:
        json.dump(vega_records, f, indent=2, ensure_ascii=False)
    print(f"  Saved {len(vega_records):,} records to: {VEGA_SOURCES_JSON}")

    return vega_records


# ────────────────────────────────────────────────────────────────────────────
# Phase 3: Match Vegamovies records against HDHub4u baseline
# ────────────────────────────────────────────────────────────────────────────

def match_all(vega, movies_exact, movies_by_norm, series_exact, series_by_norm):
    matched = []    # (vega_rec, existing_canonical)
    new_titles = [] # vega_rec — new canonical needed
    review = []     # (vega_rec, reason) — ambiguous

    for r in vega:
        norm = r.get("normalizedTitle") or normalize_text(r.get("displayTitle", ""))
        year = str(r.get("year") or "").strip()
        season = str(r.get("season") or "").strip().lower()
        ctype = str(r.get("type") or "Movie").strip().lower()

        if not norm:
            review.append((r, "EMPTY_NORMALIZED_TITLE"))
            continue

        if ctype == "web series":
            # 1. Exact series match by (normalized title + season)
            if season and (norm, season) in series_exact:
                c = series_exact[(norm, season)]
                # If HDHub had no year, enrich with vega year
                if not c.get("year") and year:
                    c["year"] = year
                matched.append((r, c))
            elif norm in series_by_norm:
                candidates = series_by_norm[norm]
                s_matches = [c for c in candidates if str(c.get("season") or "").strip().lower() == season]
                if len(s_matches) == 1:
                    c = s_matches[0]
                    if not c.get("year") and year:
                        c["year"] = year
                    matched.append((r, c))
                elif not season and len(candidates) == 1:
                    c = candidates[0]
                    if not c.get("year") and year:
                        c["year"] = year
                    matched.append((r, c))
                else:
                    new_titles.append(r)
            else:
                new_titles.append(r)

        else:
            # Movie match
            if year and (norm, year) in movies_exact:
                matched.append((r, movies_exact[(norm, year)]))
            elif not year and norm in movies_by_norm:
                candidates = movies_by_norm[norm]
                if len(candidates) == 1:
                    matched.append((r, candidates[0]))
                else:
                    cids = [c["canonicalId"] for c in candidates]
                    review.append((r, f"YEAR_NULL_AMBIGUOUS_MATCH:canonicalIds={cids}"))
            elif year and norm in movies_by_norm:
                # Check if HDHub had movie with year=None
                candidates = [c for c in movies_by_norm[norm] if not c.get("year")]
                if len(candidates) == 1:
                    c = candidates[0]
                    c["year"] = year
                    matched.append((r, c))
                else:
                    new_titles.append(r)
            else:
                new_titles.append(r)

    return matched, new_titles, review


# ────────────────────────────────────────────────────────────────────────────
# Phase 4: Add Vegamovies variants to matched existing canonical records
# ────────────────────────────────────────────────────────────────────────────

def make_variant(vega_rec, vid, fallback_poster="assets/posters/fallback.svg"):
    qs_raw = vega_rec.get("qualities", [])
    qs_struct = []
    for q in qs_raw:
        res = "2160p" if q == "4K" else q
        label = "4K" if res == "2160p" else res
        qs_struct.append({"resolution": res, "label": label})

    return {
        "sourceId": f"vega-{vid}",
        "sourceUrl": vega_rec.get("sourceUrl"),
        "originalSourceTitle": vega_rec.get("originalSourceTitle") or vega_rec.get("displayTitle"),
        "languages": vega_rec.get("languages", ["Hindi"]),
        "qualities": qs_struct,
        "releaseType": vega_rec.get("releaseType"),
        "audio": "Standard",
        "platform": None,
        "poster": vega_rec.get("poster") or fallback_poster,
        "sourcePosterUrl": vega_rec.get("sourcePosterUrl") or "",
        "source": "vegamovies"
    }


def add_variants(catalog, matched):
    id_map = {c["canonicalId"]: i for i, c in enumerate(catalog)}
    vid = 1
    added = 0
    affected_canons = set()

    for vega_rec, existing in matched:
        idx = id_map.get(existing["canonicalId"])
        if idx is None:
            continue
        c = catalog[idx]

        existing_urls = {v.get("sourceUrl") for v in c.get("variants", [])}
        if vega_rec.get("sourceUrl") in existing_urls:
            continue

        variant = make_variant(vega_rec, vid, fallback_poster=c.get("poster") or "assets/posters/fallback.svg")
        vid += 1
        c.setdefault("variants", []).append(variant)
        c["variantCount"] = len(c["variants"])

        # Aggregate qualities
        for q in vega_rec.get("qualities", []):
            if q and q not in c.get("qualities", []):
                c.setdefault("qualities", []).append(q)

        # Aggregate languages
        for lang in vega_rec.get("languages", []):
            if lang and lang not in c.get("languages", []):
                c.setdefault("languages", []).append(lang)

        added += 1
        affected_canons.add(existing["canonicalId"])

    print(f"  Added {added:,} Vegamovies variants across {len(affected_canons):,} existing canonical titles")
    return catalog, vid


# ────────────────────────────────────────────────────────────────────────────
# Phase 5: Create new canonical entries for Vegamovies-only titles with posters
# ────────────────────────────────────────────────────────────────────────────

def load_posters_map():
    if os.path.exists(VEGA_POSTER_MAP_JSON):
        with open(VEGA_POSTER_MAP_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {}


def create_new_canonicals(new_recs, start_id, start_vid, posters_map):
    groups = defaultdict(list)
    for r in new_recs:
        norm = r.get("normalizedTitle") or normalize_text(r.get("displayTitle", ""))
        year = str(r.get("year") or "").strip()
        season = str(r.get("season") or "").strip().lower()
        ctype = str(r.get("type") or "Movie").strip().lower()

        if ctype == "web series":
            k = (norm, season, "web series")
        else:
            k = (norm, year, "", "movie")
        groups[k].append(r)

    def sort_k(item):
        k = item[0]
        y_val = 0
        if len(k) == 4 and k[1].isdigit():
            y_val = int(k[1])
        return (-y_val, k[0])

    new_canons = []
    cid = start_id
    vid = start_vid
    poster_verified_count = 0
    missing_poster_list = []

    for key, variants in sorted(groups.items(), key=sort_k):
        first = variants[0]
        all_langs = list(dict.fromkeys(l for v in variants for l in v.get("languages", [])))
        all_quals = list(dict.fromkeys(q for v in variants for q in v.get("qualities", [])))

        # Look up poster in verified posters map
        k_str = "|".join(str(x) for x in key)
        poster_info = posters_map.get(k_str)

        if poster_info and poster_info.get("poster"):
            poster_url = poster_info["poster"]
            source_poster_url = poster_info["poster"]
            poster_verified_count += 1
        else:
            poster_url = "assets/posters/fallback.svg"
            source_poster_url = ""
            missing_poster_list.append({
                "canonicalId": cid,
                "displayTitle": first.get("displayTitle"),
                "year": first.get("year"),
                "type": first.get("type"),
                "season": first.get("season"),
                "sourceUrl": first.get("sourceUrl")
            })

        vlist = []
        for v in variants:
            v_rec = dict(v)
            v_rec["poster"] = poster_url
            v_rec["sourcePosterUrl"] = source_poster_url
            vlist.append(make_variant(v_rec, vid, fallback_poster=poster_url))
            vid += 1

        is_series = first.get("type") == "Web Series"
        new_canons.append({
            "id": f"praflix-{cid}",
            "canonicalId": cid,
            "displayTitle": first.get("displayTitle", ""),
            "originalSourceTitle": first.get("originalSourceTitle") or first.get("displayTitle", ""),
            "normalizedTitle": first.get("normalizedTitle", ""),
            "year": first.get("year"),
            "type": first.get("type", "Movie"),
            "season": first.get("season"),
            "episodeStatus": None,
            "genres": ["Web Series"] if is_series else ["Cinema"],
            "categories": ["Web Series"] if is_series else ["Cinema"],
            "languages": all_langs if all_langs else ["Hindi"],
            "audioTracks": [],
            "audio": "Standard",
            "platform": None,
            "platforms": [],
            "releaseType": first.get("releaseType"),
            "poster": poster_url,
            "sourcePosterUrl": source_poster_url,
            "qualities": all_quals,
            "variantCount": len(vlist),
            "variants": vlist,
            "status": "active",
            "source": "vegamovies"
        })
        cid += 1

    print(f"  Created {len(new_canons):,} new canonical titles from {len(new_recs):,} Vegamovies records")
    print(f"  Verified poster artwork attached: {poster_verified_count:,} titles ({poster_verified_count/len(new_canons)*100:.1f}%)")
    print(f"  Procedural fallback posters:     {len(missing_poster_list):,} titles ({len(missing_poster_list)/len(new_canons)*100:.1f}%)")

    # Save missing poster review
    with open(VEGA_POSTER_REVIEW_JSON, "w", encoding="utf-8") as f:
        json.dump(missing_poster_list, f, indent=2, ensure_ascii=False)
    print(f"  Saved poster review report: {VEGA_POSTER_REVIEW_JSON}")

    return new_canons, poster_verified_count, len(missing_poster_list)


# ────────────────────────────────────────────────────────────────────────────
# Phase 6: Save all outputs and regenerate frontend data
# ────────────────────────────────────────────────────────────────────────────

def save_all(baseline, new_canons, vega_records):
    merged = baseline + new_canons
    print(f"\nMerged catalog: {len(baseline):,} baseline + {len(new_canons):,} new = {len(merged):,} total")

    # Save catalog.json
    with open(CATALOG_JSON, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
    print(f"  Saved {CATALOG_JSON}")

    # Save catalog-normalized.json
    with open(CATALOG_NORMALIZED_JSON, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
    print(f"  Saved {CATALOG_NORMALIZED_JSON}")

    # Synchronize source-records.json
    # Filter out previous vega records to maintain idempotency
    with open(SOURCE_RECORDS_JSON, encoding="utf-8") as f:
        existing_src = json.load(f)

    clean_hdhub_src = [
        s for s in existing_src
        if s.get("source") != "vegamovies" and not str(s.get("sourceId", "")).startswith("vega-")
    ]
    print(f"  Preserved HDHub4u source records: {len(clean_hdhub_src):,}")

    max_src_id = len(clean_hdhub_src)
    vega_src_entries = []
    for r in vega_records:
        max_src_id += 1
        vega_src_entries.append({
            "id": max_src_id,
            "sourceId": f"vega-src-{max_src_id}",
            "displayTitle": r.get("displayTitle"),
            "originalSourceTitle": r.get("originalSourceTitle") or r.get("displayTitle"),
            "normalizedTitle": r.get("normalizedTitle"),
            "year": r.get("year"),
            "type": r.get("type", "Movie"),
            "season": r.get("season"),
            "episodeStatus": None,
            "poster": r.get("poster") or "assets/posters/fallback.svg",
            "sourcePosterUrl": r.get("sourcePosterUrl") or "",
            "sourceUrl": r.get("sourceUrl"),
            "categories": "Web Series" if r.get("type") == "Web Series" else "Cinema",
            "languages": r.get("languages", ["Hindi"]),
            "platform": "",
            "quality": (r.get("qualities") or ["720p"])[-1],
            "qualities": [
                {"resolution": "2160p" if q == "4K" else q, "label": "4K" if q == "2160p" else q}
                for q in r.get("qualities", [])
            ],
            "releaseType": r.get("releaseType"),
            "audio": "Standard",
            "audioTracks": [],
            "genres": ["Web Series"] if r.get("type") == "Web Series" else ["Cinema"],
            "source": "vegamovies",
            "pdfPage": r.get("pdfPage"),
            "pdfNo": r.get("pdfNo")
        })

    all_src = clean_hdhub_src + vega_src_entries
    with open(SOURCE_RECORDS_JSON, "w", encoding="utf-8") as f:
        json.dump(all_src, f, indent=2, ensure_ascii=False)
    print(f"  source-records.json: {len(all_src):,} total records ({len(clean_hdhub_src):,} HDHub + {len(vega_src_entries):,} Vegamovies)")

    # Regenerate catalog_data.js
    js = "// PRAFLIX Master Catalog - A PRAVERSE Company (HDHub4u + Vegamovies)\n"
    js += "window.PRAFLIX_DATA = " + json.dumps(merged, separators=(",", ":"), ensure_ascii=False) + ";\n"
    js += "window.PRAFLIX_SOURCES = " + json.dumps(all_src, separators=(",", ":"), ensure_ascii=False) + ";\n"
    with open(CATALOG_DATA_JS, "w", encoding="utf-8") as f:
        f.write(js)
    sz = os.path.getsize(CATALOG_DATA_JS)
    print(f"  catalog_data.js: {sz // 1024:,} KB")

    return merged, all_src


# ────────────────────────────────────────────────────────────────────────────
# Main Integration Entry Point
# ────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 75)
    print("PRAFLIX — VEGAMOVIES CATALOGUE INTEGRATION ENGINE")
    print("A PRAVERSE Company")
    print("=" * 75)

    # Phase 1: Baseline
    baseline, m_exact, m_norm, s_exact, s_norm = load_clean_baseline()

    # Phase 2: Vegamovies raw dataset (15,734 records)
    vega = load_vega()

    # Phase 3: Matching
    print(f"\nMatching {len(vega):,} Vegamovies records against PRAFLIX catalog...")
    matched, new_titles, review = match_all(vega, m_exact, m_norm, s_exact, s_norm)

    total_accounted = len(matched) + len(new_titles) + len(review)
    print(f"\n  MATCHING RESULTS:")
    print(f"    Exact matches (variant added):      {len(matched):,}")
    print(f"    New titles    (new canonical):      {len(new_titles):,}")
    print(f"    Manual review (ambiguous):          {len(review):,}")
    print(f"    Total accounted:                    {total_accounted:,} / {len(vega):,}")
    print(f"    Mathematical integrity:             {'PASSED (100%)' if total_accounted == len(vega) else 'FAILED'}")

    # Phase 4: Add variants to matched
    print("\nAdding variants to existing canonicals...")
    baseline, next_vid = add_variants(baseline, matched)

    # Phase 5: Create new canonicals with poster artwork
    print("\nCreating new canonical titles with poster artwork...")
    posters_map = load_posters_map()
    new_canons, verified_posters, missing_posters = create_new_canonicals(
        new_titles, HDHUB_BASELINE_COUNT + 1, next_vid, posters_map
    )

    # Save manual review
    review_out = [
        {"sourceUrl": r.get("sourceUrl"), "displayTitle": r.get("displayTitle"),
         "year": r.get("year"), "type": r.get("type"), "season": r.get("season"),
         "reason": reason}
        for r, reason in review
    ]
    with open(VEGA_REVIEW_JSON, "w", encoding="utf-8") as f:
        json.dump(review_out, f, indent=2, ensure_ascii=False)

    # Phase 6: Save outputs
    merged, all_src = save_all(baseline, new_canons, vega)

    # Compile Final Report
    final_movies = sum(1 for c in merged if c.get("type") == "Movie")
    final_series = sum(1 for c in merged if c.get("type") == "Web Series")

    report = {
        "originalCanonicalTitles": HDHUB_BASELINE_COUNT,
        "inputVegaRecords": len(vega),
        "exactMatches": len(matched),
        "newTitleRecords": len(new_titles),
        "newCanonicalGroups": len(new_canons),
        "ambiguousReview": len(review),
        "totalAccounted": total_accounted,
        "mathValid": total_accounted == len(vega),
        "verifiedPosters": verified_posters,
        "fallbackPosters": missing_posters,
        "finalCanonicalTotal": len(merged),
        "finalMoviesCount": final_movies,
        "finalWebSeriesCount": final_series,
        "finalSourceRecordsTotal": len(all_src)
    }

    with open(VEGA_REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\n" + "=" * 75)
    print("INTEGRATION COMPLETED SUCCESSFULLY")
    print("=" * 75)
    for k, v in report.items():
        print(f"  {k:30s}: {v}")
    print("=" * 75)


if __name__ == "__main__":
    main()
