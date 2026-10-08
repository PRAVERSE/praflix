#!/usr/bin/env python3
"""
PRAFLIX — A PRAVERSE Company
Production Build & Asset Optimization Engine for Cloudflare Pages / Workers

Builds a pristine, strictly compliant production output directory (`dist`)
guaranteeing:
1. No individual file exceeds Cloudflare's 25 MiB limit.
2. Total file count stays well below the 20,000 limit.
3. 100% lossless catalogue data preservation (all 11,832 records intact).
4. No source data, tests, crawl caches, or dev files leaked to production.
5. Poster-priority index generated for client-side catalogue ordering.
6. Download links data exported for the detail-page download section.
"""

import os
import sys
import json
import shutil
import time

sys.stdout.reconfigure(encoding='utf-8')

MAX_CLOUDFLARE_FILE_BYTES = 25 * 1024 * 1024  # 26,214,400 bytes (25 MiB)
MAX_CLOUDFLARE_FILE_COUNT = 20000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, "dist")
DATA_DIR = os.path.join(BASE_DIR, "data")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
POSTERS_SRC_DIR = os.path.join(ASSETS_DIR, "posters")

# Poster files at or below this size are considered corrupt/broken placeholders
POSTER_BROKEN_BYTE_THRESHOLD = 503

from crawler.export_chunks import export_catalog_chunks


def link_or_copy(src, dst):
    """Link file if supported (NTFS / POSIX), otherwise copy."""
    if os.path.exists(dst):
        if os.path.getsize(src) == os.path.getsize(dst):
            return
        os.remove(dst)
    try:
        os.link(src, dst)
    except Exception:
        shutil.copy2(src, dst)


def compute_valid_poster_ids(master_records, poster_src_dir, report_json_path=None):
    """
    Returns a sorted list of canonicalIds whose poster files exist on disk
    and are confirmed valid real images (not placeholder SVGs or corrupt stubs).

    If poster-yearwise-report.json is available, synchronizes with the verified audit.
    Otherwise, verifies local disk assets directly excluding fallback.svg and corrupt files.

    Returns:
        (valid_ids: list[int], invalid_ids: list[int], stats: dict, ordered_valid_ids: list[int])
    """
    if report_json_path and os.path.exists(report_json_path):
        with open(report_json_path, "r", encoding="utf-8") as f:
            rep = json.load(f)
        ordered_valid_ids = [
            item["canonicalId"]
            for s in rep.get("yearSummaries", [])
            for item in (rep.get("catalogByYear", {}).get(s["year"], {}).get("movies", []) +
                         rep.get("catalogByYear", {}).get(s["year"], {}).get("series", []))
        ]
        valid_set = set(ordered_valid_ids)
        valid_ids = sorted(list(valid_set))
        invalid_ids = [r["canonicalId"] for r in master_records if r["canonicalId"] not in valid_set]
    else:
        poster_files_on_disk = set(os.listdir(poster_src_dir))
        valid_set = set()
        invalid_ids = []

        for record in master_records:
            cid = record.get("canonicalId")
            poster_path = record.get("poster", "")

            is_valid = False
            if poster_path and poster_path.startswith("assets/posters/"):
                filename = poster_path[len("assets/posters/"):]
                if filename in poster_files_on_disk and filename != "fallback.svg":
                    fpath = os.path.join(poster_src_dir, filename)
                    file_size = os.path.getsize(fpath)
                    if file_size > POSTER_BROKEN_BYTE_THRESHOLD:
                        # Check binary magic numbers
                        try:
                            with open(fpath, "rb") as bf:
                                header = bf.read(16)
                            if (header.startswith(b"\xff\xd8\xff") or
                                header.startswith(b"\x89PNG\r\n\x1a\n") or
                                (header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP")):
                                is_valid = True
                        except Exception:
                            is_valid = False

            if is_valid:
                valid_set.add(cid)
            else:
                invalid_ids.append(cid)

        # Sort verified records by year descending, type (Movie first), title ascending
        def sort_key(c):
            y = int(c["year"]) if c.get("year") and str(c["year"]).isdigit() else 0
            t = 0 if c.get("type") == "Movie" else 1
            name = c.get("displayTitle") or ""
            return (-y, t, name.lower())

        verified_records = sorted([r for r in master_records if r.get("canonicalId") in valid_set], key=sort_key)
        ordered_valid_ids = [r["canonicalId"] for r in verified_records]
        valid_ids = sorted(list(valid_set))

    stats = {
        "totalRecords": len(master_records),
        "validPosterCount": len(valid_ids),
        "invalidPosterCount": len(invalid_ids),
        "brokenThresholdBytes": POSTER_BROKEN_BYTE_THRESHOLD,
    }
    return valid_ids, invalid_ids, stats, ordered_valid_ids


def build_production_distribution():
    print("=" * 70)
    print("PRAFLIX PRODUCTION BUILD FOR CLOUDFLARE PAGES / WORKERS")
    print("A PRAVERSE Company")
    print("=" * 70)
    t0 = time.time()

    # Step 1: Validate master source data
    master_catalog_path = os.path.join(DATA_DIR, "catalog.json")
    if not os.path.exists(master_catalog_path):
        raise FileNotFoundError(f"Master catalog not found at {master_catalog_path}")

    with open(master_catalog_path, "r", encoding="utf-8") as f:
        master_records = json.load(f)

    total_records = len(master_records)
    print(f"[1/8] Validated master catalog: {total_records:,} canonical records.")
    if total_records != 11832:
        print(f"  Warning: Expected 11,832 records, found {total_records:,}")

    # Step 2: Prepare dist directory structure
    dist_assets_dir = os.path.join(DIST_DIR, "assets")
    dist_posters_dir = os.path.join(dist_assets_dir, "posters")
    dist_data_dir = os.path.join(DIST_DIR, "data")

    os.makedirs(dist_posters_dir, exist_ok=True)
    os.makedirs(dist_data_dir, exist_ok=True)
    print(f"[2/8] Prepared target output structure at: {DIST_DIR}")

    # Step 3: Copy runtime web assets
    runtime_files = ["index.html", "styles.css", "app.js", "admin.html"]
    for rf in runtime_files:
        src = os.path.join(BASE_DIR, rf)
        dst = os.path.join(DIST_DIR, rf)
        if not os.path.exists(src):
            if rf == "admin.html":
                print(f"  Note: {rf} not found, skipping (optional).")
                continue
            raise FileNotFoundError(f"Required runtime file missing: {src}")
        shutil.copy2(src, dst)
    print(f"[3/8] Installed core frontend runtime assets.")

    # Step 4: Export compliant catalogue chunks into dist/data
    print(f"[4/8] Partitioning catalog into Cloudflare-compliant static chunks (<25 MiB)...")
    chunk_summary = export_catalog_chunks(master_records, dist_data_dir, num_chunks=4, write_monolithic=True)
    print(f"  Exported {chunk_summary['totalRecords']:,} records across {chunk_summary['chunkCount']} chunks.")
    for fname, size_b, count in chunk_summary["files"]:
        print(f"  - {fname}: {size_b / (1024*1024):.2f} MiB ({count:,} records)")

    # Step 5: Generate poster-valid-ids.js (build-time computed, used by client for poster priority sort)
    print(f"[5/8] Computing poster validity index for client-side catalogue ordering...")
    report_json_path = os.path.join(BASE_DIR, "poster-yearwise-report", "poster-yearwise-report.json")
    valid_ids, invalid_ids, poster_stats, ordered_valid_ids = compute_valid_poster_ids(master_records, POSTERS_SRC_DIR, report_json_path)

    # Write as a compact JS assignment: window.PRAFLIX_POSTER_VALID_IDS = new Set([...])
    ids_js_content = (
        "/* PRAFLIX Poster Validity Index — generated from verified catalogue audit */\n"
        "/* Records with confirmed real poster files (> 503 bytes) on disk */\n"
        f"/* Valid: {poster_stats['validPosterCount']:,} | "
        f"Invalid/Missing: {poster_stats['invalidPosterCount']:,} | "
        f"Total: {poster_stats['totalRecords']:,} */\n"
        f"window.PRAFLIX_POSTER_VALID_IDS = new Set({json.dumps(valid_ids, separators=(',', ':'))});\n"
        f"window.PRAFLIX_POSTER_ORDERED_IDS = {json.dumps(ordered_valid_ids, separators=(',', ':'))};\n"
        "window.PRAFLIX_POSTER_ORDER_MAP = new Map(window.PRAFLIX_POSTER_ORDERED_IDS.map((id, idx) => [id, idx]));\n"
    )
    # Write to dist/data for Cloudflare production deployment
    poster_ids_js_dist_path = os.path.join(dist_data_dir, "poster-valid-ids.js")
    with open(poster_ids_js_dist_path, "w", encoding="utf-8") as f:
        f.write(ids_js_content)

    # Write to data/ for local development & root index.html preview
    poster_ids_js_local_path = os.path.join(DATA_DIR, "poster-valid-ids.js")
    with open(poster_ids_js_local_path, "w", encoding="utf-8") as f:
        f.write(ids_js_content)

    ids_js_size = os.path.getsize(poster_ids_js_dist_path)
    print(f"  poster-valid-ids.js: {ids_js_size / 1024:.1f} KB "
          f"({poster_stats['validPosterCount']:,} valid / "
          f"{poster_stats['invalidPosterCount']:,} invalid)")

    # Also write a JSON version for tooling / tests (both dist and local data)
    poster_index_json = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "brokenThresholdBytes": POSTER_BROKEN_BYTE_THRESHOLD,
        "validPosterCount": poster_stats["validPosterCount"],
        "invalidPosterCount": poster_stats["invalidPosterCount"],
        "totalRecords": poster_stats["totalRecords"],
        "validCanonicalIds": valid_ids,
        "orderedValidCanonicalIds": ordered_valid_ids,
        "invalidCanonicalIds": invalid_ids,
    }
    with open(os.path.join(dist_data_dir, "poster-index.json"), "w", encoding="utf-8") as f:
        json.dump(poster_index_json, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(DATA_DIR, "poster-index.json"), "w", encoding="utf-8") as f:
        json.dump(poster_index_json, f, separators=(",", ":"), ensure_ascii=False)

    # Step 6: Copy downloads data file (download links for detail pages)
    print(f"[6/8] Exporting download links data...")
    src_downloads = os.path.join(DATA_DIR, "downloads.json")
    if not os.path.exists(src_downloads):
        # Create an empty-but-valid downloads.json
        empty_downloads = {
            "version": "1.0",
            "description": "PRAFLIX Download Links — administrator-curated verified download options",
            "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "entries": []
        }
        with open(src_downloads, "w", encoding="utf-8") as f:
            json.dump(empty_downloads, f, indent=2, ensure_ascii=False)
        print("  Created empty downloads.json placeholder.")

    shutil.copy2(src_downloads, os.path.join(dist_data_dir, "downloads.json"))
    dl_size = os.path.getsize(os.path.join(dist_data_dir, "downloads.json"))
    print(f"  downloads.json: {dl_size / 1024:.1f} KB")

    # Step 7: Transfer / link posters
    print(f"[7/8] Syncing poster artwork library...")
    poster_files = [f for f in os.listdir(POSTERS_SRC_DIR) if os.path.isfile(os.path.join(POSTERS_SRC_DIR, f))]
    for pf in poster_files:
        src = os.path.join(POSTERS_SRC_DIR, pf)
        dst = os.path.join(dist_posters_dir, pf)
        link_or_copy(src, dst)
    print(f"  Synced {len(poster_files):,} poster files into dist/assets/posters/")

    # Step 8: Configure Cloudflare edge caching headers
    dist_redirects_path = os.path.join(DIST_DIR, "_redirects")
    if os.path.exists(dist_redirects_path):
        os.remove(dist_redirects_path)

    headers_content = """/assets/posters/*
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
  Access-Control-Allow-Origin: *
"""
    with open(os.path.join(DIST_DIR, "_headers"), "w", encoding="utf-8") as f:
        f.write(headers_content)
    print(f"[8/8] Configured Cloudflare edge performance _headers.")

    # =========================================================================
    # Asset Audit & Verification
    # =========================================================================
    print("\n" + "=" * 70)
    print("CLOUDFLARE PAGES & WORKERS ASSET AUDIT")
    print("=" * 70)

    oversized_files = []
    forbidden_files = []
    total_files = 0
    total_bytes = 0
    largest_file = ("", 0)

    forbidden_exts = {".py", ".pyc", ".csv", ".log", ".backup"}
    forbidden_names = {
        "catalog-normalized.json", "source-records.json", "source-inventory.json",
        "source-ledger.json", "master_url_inventory.json", "sync-state.json",
        "external-movie-reconciliation.json", "catalog_data.js"
    }

    for root, dirs, files in os.walk(DIST_DIR):
        for f in files:
            total_files += 1
            fpath = os.path.join(root, f)
            rel_path = os.path.relpath(fpath, DIST_DIR).replace("\\", "/")
            fsize = os.path.getsize(fpath)
            total_bytes += fsize

            if fsize > largest_file[1]:
                largest_file = (rel_path, fsize)

            if fsize > MAX_CLOUDFLARE_FILE_BYTES:
                oversized_files.append((rel_path, fsize))

            _, ext = os.path.splitext(f)
            if ext in forbidden_exts or f in forbidden_names:
                forbidden_files.append(rel_path)

    print(f"Total Output Files: {total_files:,} / {MAX_CLOUDFLARE_FILE_COUNT:,} limit")
    print(f"Total Output Size:  {total_bytes / (1024*1024):.2f} MiB")
    print(f"Largest Asset:      {largest_file[0]} ({largest_file[1] / (1024*1024):.2f} MiB)")
    print(f"Size Limit:         {MAX_CLOUDFLARE_FILE_BYTES / (1024*1024):.2f} MiB per individual asset")
    print(f"Poster Index:       {poster_stats['validPosterCount']:,} valid / "
          f"{poster_stats['invalidPosterCount']:,} missing/broken")

    if oversized_files:
        print("\n[CRITICAL FAILURE] Oversized assets detected exceeding 25 MiB:")
        for name, sz in oversized_files:
            print(f"  - {name}: {sz / (1024*1024):.2f} MiB")
        raise RuntimeError(f"Build failed: {len(oversized_files)} asset(s) exceed Cloudflare's 25 MiB limit.")

    if forbidden_files:
        print("\n[WARNING] Forbidden development / source files detected in dist:")
        for name in forbidden_files:
            print(f"  - {name}")
        raise RuntimeError(f"Build failed: Development or source files leaked into production dist.")

    if total_files > MAX_CLOUDFLARE_FILE_COUNT:
        raise RuntimeError(f"Build failed: Total file count ({total_files:,}) exceeds Cloudflare limit ({MAX_CLOUDFLARE_FILE_COUNT:,}).")

    # Reconstruct all records from dist chunks and assert 100% integrity
    dist_manifest_path = os.path.join(dist_data_dir, "catalog-manifest.json")
    with open(dist_manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    reconstructed_from_dist = []
    for cpath in manifest["chunks"]:
        chunk_file = os.path.join(DIST_DIR, cpath)
        with open(chunk_file, "r", encoding="utf-8") as f:
            reconstructed_from_dist.extend(json.load(f))

    if len(reconstructed_from_dist) != total_records or reconstructed_from_dist != master_records:
        raise RuntimeError("Integrity verification failed: dist chunks do not match master catalog data.")

    t_elapsed = time.time() - t0
    print("\n" + "=" * 70)
    print(f"BUILD SUCCEEDED in {t_elapsed:.2f}s!")
    print(f"Status: 100% READY FOR CLOUDFLARE DEPLOYMENT")
    print(f"Output Directory: {DIST_DIR}")
    print(f"All {total_records:,} catalog titles intact across {chunk_summary['chunkCount']} chunks.")
    print(f"Every asset <= {largest_file[1] / (1024*1024):.2f} MiB (well below 25 MiB limit).")
    print(f"Poster Priority: {poster_stats['validPosterCount']:,} titles ready for pages 1-10.")
    print("=" * 70)
    return True


if __name__ == "__main__":
    try:
        build_production_distribution()
    except Exception as e:
        print(f"\n[ERROR] Build aborted: {e}")
        sys.exit(1)
