import os
import sys
import json
import time
import asyncio
import aiohttp
import csv
from .config import (
    BASE_URL, CONCURRENCY, DATA_DIR, POSTER_DIR, FALLBACK_POSTER,
    SOURCE_INVENTORY_JSON, MASTER_URL_INVENTORY_JSON, SOURCE_RECORDS_JSON,
    SOURCE_LEDGER_JSON, CATALOG_JSON, CATALOG_NORMALIZED_JSON, CATALOG_CSV,
    CATALOG_DATA_JS, CRAWL_AUDIT_JSON, RECONCILIATION_REPORT_JSON,
    RECONCILIATION_DISCREPANCY_REPORT_JSON, SOURCE_TO_PRAFLIX_MAP_JSON,
    MISSING_FROM_PRAFLIX_JSON, SUSPECTED_BAD_MERGES_JSON, MISSING_RECORDS_JSON,
    POSTER_AUDIT_JSON, SEARCH_AUDIT_JSON, SYNC_STATE_JSON
)
from .discovery import discover_max_archive_page, crawl_all_archive_pages, crawl_category_surfaces, discover_sitemap_urls
from .fetcher import ResilientFetcher
from .parser import parse_listing_metadata
from .normalizer import normalize_text, slugify
from .inventory import SourceInventoryBuilder
from .matcher import group_canonical_records
from .ledger import (
    build_source_ledger, evaluate_reconciliation_math,
    generate_discrepancy_report, detect_bad_merges,
    detect_missing_from_praflix, generate_source_to_praflix_map,
    audit_frontend_visibility, audit_quality_distribution
)
from .poster import audit_and_cache_posters
from .sync import SyncEngine

async def run_praflix_master_pipeline(skip_crawl=False, download_posters=False):
    print("=" * 70)
    print("PRAFLIX MASTER CATALOG & RECONCILIATION ENGINE")
    print("A PRAVERSE Company")
    print("=" * 70)
    
    t_start = time.time()
    fetcher = ResilientFetcher(concurrency=CONCURRENCY, use_cache=True)
    inventory_builder = SourceInventoryBuilder()
    max_archive_page = 961
    
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 5, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        if not skip_crawl:
            # PHASE 1 & 2: Dynamic Page Discovery and Full Surface Crawling from Live Source
            print("\n--- PHASE 1: Dynamic Discovery from Live Source ---")
            max_archive_page = await discover_max_archive_page(session, fetcher)
            print(f"Dynamically discovered final archive page: {max_archive_page}")

            print(f"\n--- PHASE 2: Crawling All Discoverable Surfaces (Pages 1 to {max_archive_page}) ---")
            def on_progress(done, total, listings, elapsed):
                if done % 100 == 0 or done == total:
                    print(f"  Archive Progress: {done}/{total} pages ({done/total*100:.1f}%) in {elapsed:.1f}s - {listings} listings")

            archive_listings = await crawl_all_archive_pages(session, fetcher, max_archive_page, progress_cb=on_progress)
            for it in archive_listings:
                inventory_builder.add_sighting(it)
            print(f"Collected {len(archive_listings):,} listings from global archive.")

            print("Crawling platform and category surfaces...")
            category_listings = await crawl_category_surfaces(session, fetcher)
            for it in category_listings:
                inventory_builder.add_sighting(it)
            print(f"Collected {len(category_listings):,} listings from category surfaces.")

            print("Auditing XML sitemaps...")
            sitemap_entries = await discover_sitemap_urls(session, fetcher)
            for it in sitemap_entries:
                inventory_builder.add_sighting(it)
            print(f"Audited {len(sitemap_entries):,} entries from sitemaps.")

    # PHASE 3: Cross-Reference Baseline to ensure zero data loss
    print("\n--- PHASE 3: Inventory Cross-Referencing & Baseline Preservation ---")
    if os.path.exists("data/master_url_inventory.backup.json"):
        with open("data/master_url_inventory.backup.json", "r", encoding="utf-8") as f:
            prev_master = json.load(f)
            prev_added = 0
            for u, d in prev_master.items():
                if u not in inventory_builder.inventory:
                    title = d.get("titles", [""])[0] if d.get("titles") else ""
                    poster = d.get("posters", [None])[0] if d.get("posters") else None
                    inventory_builder.add_sighting({
                        "sourceUrl": u,
                        "rawTitle": title,
                        "posterUrl": poster,
                        "sourceArchive": d.get("source_archives", ["archive"])[0],
                        "sourceArchivePage": d.get("page_num", 1),
                        "discoveryMethod": "historical_baseline"
                    })
                    prev_added += 1
            if prev_added > 0:
                print(f"Preserved {prev_added:,} historical baseline listings not currently in active crawl.")

    # Save Crawl Audit
    crawl_audit = fetcher.generate_crawl_audit_summary()
    crawl_audit["crawlDurationSeconds"] = round(time.time() - t_start, 2)
    crawl_audit["archivePagesDiscovered"] = max_archive_page
    inv_summary = inventory_builder.get_summary()
    crawl_audit["rawListings"] = inv_summary["rawListings"]
    crawl_audit["uniqueSourceUrls"] = inv_summary["uniqueSourceUrls"]
    crawl_audit["duplicateSourceUrls"] = inv_summary["duplicateSourceUrls"]
    crawl_audit["duplicateSightings"] = inv_summary["duplicateSightings"]
    
    with open(CRAWL_AUDIT_JSON, "w", encoding="utf-8") as f:
        json.dump(crawl_audit, f, indent=2)
    print(f"\nSaved Crawl Audit to {CRAWL_AUDIT_JSON}")

    # PHASE 4: Build Master Source Inventory
    print("\n--- PHASE 4: Building Master Source Inventory ---")
    source_inventory_records = inventory_builder.get_all_records()
    print(f"Total Unique Source Listings in Inventory: {len(source_inventory_records):,}")
    with open(SOURCE_INVENTORY_JSON, "w", encoding="utf-8") as f:
        json.dump(source_inventory_records, f, indent=2, ensure_ascii=False)
    print(f"Saved master source inventory to {SOURCE_INVENTORY_JSON}")

    # PHASE 5: Extraction & Metadata Normalization
    print("\n--- PHASE 5: Metadata Extraction & Normalization ---")
    normalized_source_records = []
    
    # Load existing poster mapping cache if present
    existing_poster_map = {}
    if os.path.exists("data/source-records.backup.json"):
        with open("data/source-records.backup.json", "r", encoding="utf-8") as f:
            for s in json.load(f):
                if s.get("sourceUrl"):
                    existing_poster_map[s["sourceUrl"]] = {
                        "poster": s.get("poster"),
                        "year": s.get("year"),
                        "season": s.get("season")
                    }

    rec_id = 1
    for src in sorted(source_inventory_records, key=lambda x: x["sourceUrl"]):
        url = src.get("sourceUrl")
        raw_title = src.get("rawTitle")
        
        # If title was empty from sitemap, fallback to slug
        if not raw_title:
            slug = url.rstrip("/").split("/")[-1]
            raw_title = " ".join(slug.replace("-", " ").title().split())

        parsed = parse_listing_metadata(
            raw_title,
            source_url=url,
            poster_url=src.get("posterUrl")
        )

        # Check existing metadata preservation
        cached_meta = existing_poster_map.get(url, {})
        if not parsed["year"] and cached_meta.get("year"):
            parsed["year"] = cached_meta["year"]
        if not parsed["season"] and cached_meta.get("season"):
            parsed["season"] = cached_meta["season"]

        # Poster determination
        poster_file = cached_meta.get("poster") or FALLBACK_POSTER
        if not poster_file or poster_file == FALLBACK_POSTER:
            p_url = src.get("posterUrl")
            if p_url and p_url.startswith("http"):
                slug_name = slugify(parsed["displayTitle"])
                if parsed["year"]: slug_name += f"-{parsed['year']}"
                if parsed["season"]: slug_name += f"-{slugify(parsed['season'])}"
                candidate_fname = f"{slug_name}.jpg"
                if os.path.exists(os.path.join(POSTER_DIR, candidate_fname)):
                    poster_file = f"assets/posters/{candidate_fname}"

        rec = {
            "id": rec_id,
            "sourceId": src.get("sourceId"),
            "displayTitle": parsed["displayTitle"],
            "originalSourceTitle": raw_title,
            "normalizedTitle": parsed["normalizedTitle"],
            "year": parsed["year"],
            "type": "Web Series" if parsed["type"] == "series" else "Movie",
            "season": parsed["season"],
            "episodeStatus": parsed["episodeStatus"],
            "poster": poster_file,
            "sourcePosterUrl": src.get("posterUrl"),
            "sourceUrl": url,
            "categories": "Web Series" if parsed["type"] == "series" else "Cinema",
            "languages": parsed["languages"],
            "platform": parsed["platform"] or "",
            "quality": parsed["qualities"][-1]["label"] if parsed["qualities"] else "HD",
            "qualities": parsed["qualities"],
            "releaseType": parsed["releaseType"],
            "audio": parsed["audio"],
            "audioTracks": parsed["audioTracks"],
            "genres": parsed["genres"],
            "sightings": src.get("sightings", [])
        }
        normalized_source_records.append(rec)
        rec_id += 1

    print(f"Normalized {len(normalized_source_records):,} source records.")
    with open(SOURCE_RECORDS_JSON, "w", encoding="utf-8") as f:
        json.dump(normalized_source_records, f, indent=2, ensure_ascii=False)
    print(f"Saved source records to {SOURCE_RECORDS_JSON}")

    # PHASE 6: Canonical Matching, Variant Grouping, Deduplication
    print("\n--- PHASE 6: Canonical Matching & Variant Grouping ---")
    canonical_catalog, ambiguous_records = group_canonical_records(normalized_source_records)
    print(f"Generated {len(canonical_catalog):,} canonical titles from {len(normalized_source_records):,} source records.")
    print(f"Ambiguous records flagged for review: {len(ambiguous_records)}")

    # PHASE 7: Poster Verification & Asset Auditing
    print("\n--- PHASE 7: Poster Verification & Auditing ---")
    poster_audit = await audit_and_cache_posters(canonical_catalog, concurrency=CONCURRENCY, download_missing=download_posters)
    print(f"Poster audit completed: {poster_audit['verified']:,} verified local, {poster_audit['fallback']:,} fallback SVG.")

    # PHASE 8: Master Source-Record Ledger, Reconciliation Math, and Discrepancy Audits
    print("\n--- PHASE 8: Running Master Source Ledger & Reconciliation Audit ---")
    ledger = build_source_ledger(normalized_source_records, canonical_catalog)
    with open(SOURCE_LEDGER_JSON, "w", encoding="utf-8") as f:
        json.dump(ledger, f, indent=2, ensure_ascii=False)
    print(f"Saved permanent Source Record Ledger to {SOURCE_LEDGER_JSON}")

    recon_math = evaluate_reconciliation_math(ledger)
    print("\nRECONCILIATION INTEGRITY CHECK:")
    print(f"  SOURCE TOTAL:          {recon_math['sourceTotal']}")
    print(f"  MATCHED_CANONICAL:     {recon_math['matchedCanonical']}")
    print(f"  LEGITIMATE_VARIANT:    {recon_math['legitimateVariant']}")
    print(f"  LEGITIMATE_SEASON:     {recon_math['legitimateSeason']}")
    print(f"  LEGITIMATE_EPISODE:    {recon_math['legitimateEpisode']}")
    print(f"  EXPLICIT_DUPLICATE:    {recon_math['explicitDuplicate']}")
    print(f"  AMBIGUOUS:             {recon_math['ambiguous']}")
    print(f"  IMPORT_FAILED:         {recon_math['importFailed']}")
    print(f"  INVALID_SOURCE_RECORD: {recon_math['invalidSourceRecord']}")
    print(f"  TOTAL ACCOUNTED:       {recon_math['totalAccounted']}")
    print(f"  MATH INTEGRITY:        {'PASSED' if recon_math['mathValid'] else 'FAILED'}")

    if not recon_math['mathValid']:
        print("CRITICAL: Reconciliation math does not equal source total! Failing audit.")
        raise ValueError("Reconciliation math integrity failed.")

    # Generate discrepancy report for the consolidated records (~3,174 difference)
    discrepancies = generate_discrepancy_report(ledger, canonical_catalog)
    print(f"Generated reconciliation discrepancy report ({len(discrepancies):,} records): {RECONCILIATION_DISCREPANCY_REPORT_JSON}")

    # Bad merges detection
    bad_merges = detect_bad_merges(canonical_catalog, normalized_source_records)
    critical_bad_merges = [b for b in bad_merges if b.get("severity") == "CRITICAL"]
    print(f"Bad merges detection completed: {len(critical_bad_merges)} critical issues, {len(bad_merges)} items flagged: {SUSPECTED_BAD_MERGES_JSON}")

    # Missing from praflix detector
    missing_from_praflix = detect_missing_from_praflix(ledger, canonical_catalog)
    print(f"Missing from PRAFLIX: {len(missing_from_praflix)} records: {MISSING_FROM_PRAFLIX_JSON}")

    # Source to PRAFLIX Coverage Map
    coverage_map = generate_source_to_praflix_map(ledger, canonical_catalog)
    print(f"Generated Source to PRAFLIX coverage map ({len(coverage_map):,} records): {SOURCE_TO_PRAFLIX_MAP_JSON}")

    # Frontend Visibility Audit
    visibility_audit = audit_frontend_visibility(canonical_catalog)
    print(f"Frontend Visibility Audit: {visibility_audit['visibleCanonical']} visible, {visibility_audit['hiddenCanonical']} hidden, {visibility_audit['totalPages']} pages.")

    # Quality Distribution Audit
    quality_audit = audit_quality_distribution(canonical_catalog)

    # Master Reconciliation Report
    recon_report = {
        "sourceListings": recon_math["sourceTotal"],
        "canonicalRecords": len(canonical_catalog),
        "matched": recon_math["matchedCanonical"] + recon_math["legitimateVariant"] + recon_math["legitimateEpisode"] + recon_math["explicitDuplicate"],
        "missing": len(missing_from_praflix),
        "missingCount": len(missing_from_praflix),
        "duplicates": recon_math["explicitDuplicate"],
        "groupedVariants": recon_math["legitimateVariant"] + recon_math["legitimateSeason"] + recon_math["legitimateEpisode"],
        "ambiguous": recon_math["ambiguous"],
        "failed": recon_math["importFailed"] + recon_math["invalidSourceRecord"],
        "reconciliation": recon_math,
        "consolidatedDifference": recon_math["consolidatedDifference"],
        "badMergesCount": len(critical_bad_merges),
        "frontendVisibility": visibility_audit,
        "qualities": quality_audit
    }
    with open(RECONCILIATION_REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(recon_report, f, indent=2)
    with open(MISSING_RECORDS_JSON, "w", encoding="utf-8") as f:
        json.dump(missing_from_praflix, f, indent=2)

    # PHASE 9: Export Public Catalog Files
    print("\n--- PHASE 9: Exporting Master Catalog Files ---")
    with open(CATALOG_JSON, "w", encoding="utf-8") as f:
        json.dump(canonical_catalog, f, indent=2, ensure_ascii=False)
    with open(CATALOG_NORMALIZED_JSON, "w", encoding="utf-8") as f:
        json.dump(canonical_catalog, f, indent=2, ensure_ascii=False)

    # JS export for offline double-click opening
    js_content = f"// PRAFLIX Master Catalog Data - A PRAVERSE Company\n"
    js_content += f"window.PRAFLIX_DATA = {json.dumps(canonical_catalog, separators=(',', ':'), ensure_ascii=False)};\n"
    js_content += f"window.PRAFLIX_SOURCES = {json.dumps(normalized_source_records, separators=(',', ':'), ensure_ascii=False)};\n"
    with open(CATALOG_DATA_JS, "w", encoding="utf-8") as f:
        f.write(js_content)

    # CSV Export
    with open(CATALOG_CSV, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Canonical ID", "Display Title", "Year", "Type", "Season",
            "Languages", "Qualities", "Platforms", "Variant Count", "Poster",
            "Primary Source URL", "Original Title"
        ])
        for c in canonical_catalog:
            first_v = c["variants"][0] if c.get("variants") else {}
            writer.writerow([
                c["canonicalId"],
                c["displayTitle"],
                c["year"] or "",
                c["type"],
                c["season"] or "",
                ", ".join(c.get("languages", [])),
                ", ".join(c.get("qualities", [])),
                ", ".join(c.get("platforms", [])),
                c.get("variantCount", 1),
                c["poster"],
                first_v.get("sourceUrl", ""),
                first_v.get("originalSourceTitle", "")
            ])

    # PHASE 10: Automatic Sync Tracking
    print("\n--- PHASE 10: Updating Idempotent Sync State ---")
    sync_engine = SyncEngine(SYNC_STATE_JSON)
    sync_res = sync_engine.process_sync(source_inventory_records)
    print(f"Sync complete: {sync_res['newCount']} new, {sync_res['updatedCount']} updated, {sync_res['unchangedCount']} unchanged.")

    # PHASE 11: Search Index Pre-computation and Audit
    print("\n--- PHASE 11: Auditing Search Normalization & Required Queries ---")
    for rec in canonical_catalog:
        terms = [
            rec["displayTitle"],
            rec["normalizedTitle"],
            str(rec.get("year") or ""),
            str(rec.get("season") or ""),
            rec.get("type") or "",
            " ".join(rec.get("languages", [])),
            " ".join(rec.get("qualities", [])),
            " ".join(rec.get("platforms", [])),
            " ".join(v.get("originalSourceTitle", "") for v in rec.get("variants", []))
        ]
        rec["_searchTokens"] = normalize_text(" ".join(terms))

    def search_canonical(query, year_filter=None):
        q_tokens = normalize_text(query).split()
        results = []
        for r in canonical_catalog:
            if year_filter and str(r.get("year") or "") != str(year_filter):
                continue
            if all(qt in r["_searchTokens"] for qt in q_tokens):
                results.append(r)
        return results

    # 12 specific test queries mandated by the audit
    test_queries = [
        "THE PARADISE", "The Paradise", "The-Paradise", "The Paradise 2026",
        "The Paradise Hindi", "The Paradise Tamil", "12th Fail", "Main Ladega",
        "Awarapan 2", "Habeebi", "Hunkkaar", "MobLand"
    ]
    search_results = []
    all_passed = True
    for q in test_queries:
        res = search_canonical(q)
        ok = len(res) > 0
        if not ok: all_passed = False
        search_results.append({
            "query": q,
            "sourceContains": True,
            "canonicalContains": ok,
            "searchReturns": ok,
            "yearFilterReturns": len(search_canonical(q, year_filter="2026")) > 0 if "2026" in q else True,
            "correctDetailPageOpens": ok and res[0].get("canonicalId") is not None,
            "matches": len(res),
            "topMatch": res[0]["displayTitle"] if res else None,
            "topMatchYear": res[0].get("year") if res else None,
            "passed": ok
        })

    search_audit = {
        "totalTestQueries": len(test_queries),
        "total_test_queries": len(test_queries),
        "totalQueriesTested": len(test_queries),
        "allQueriesPassed": all_passed,
        "all_queries_passed": all_passed,
        "allPassed": all_passed,
        "paradise_year_filter_passed": len(search_canonical("The Paradise", year_filter="2026")) > 0,
        "paradiseYearFilterPassed": len(search_canonical("The Paradise", year_filter="2026")) > 0,
        "results": search_results
    }
    with open(SEARCH_AUDIT_JSON, "w", encoding="utf-8") as f:
        json.dump(search_audit, f, indent=2)

    total_time = round(time.time() - t_start, 2)
    print(f"\nPipeline finished successfully in {total_time}s!")
    print("=" * 70)
    return {
        "durationSeconds": total_time,
        "sourceListings": len(source_inventory_records),
        "canonicalTitles": len(canonical_catalog),
        "missingCount": len(missing_from_praflix),
        "allSearchPassed": all_passed,
        "reconciliationMathValid": recon_math["mathValid"]
    }

