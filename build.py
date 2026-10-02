#!/usr/bin/env python3
"""
PRAFLIX — A PRAVERSE Company
Production Build & Asset Optimization Engine for Cloudflare Pages / Workers

Builds a pristine, strictly compliant production output directory (`dist`)
guaranteeing:
1. No individual file exceeds Cloudflare's 25 MiB limit.
2. Total file count stays well below the 20,000 limit.
3. 100% lossless catalogue data preservation (all 15,433 records intact).
4. No source data, tests, crawl caches, or dev files leaked to production.
"""

import os
import sys
import json
import shutil
import time

sys.stdout.reconfigure(encoding='utf-8')

MAX_CLOUDFLARE_FILE_BYTES = 25 * 1024 * 1024 # 26,214,400 bytes (25 MiB)
MAX_CLOUDFLARE_FILE_COUNT = 20000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, "dist")
DATA_DIR = os.path.join(BASE_DIR, "data")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
POSTERS_SRC_DIR = os.path.join(ASSETS_DIR, "posters")

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
    print(f"[1/6] Validated master catalog: {total_records:,} canonical records.")
    if total_records != 15433:
        print(f"  Warning: Expected 15,433 records, found {total_records:,}")

    # Step 2: Prepare dist directory structure
    dist_assets_dir = os.path.join(DIST_DIR, "assets")
    dist_posters_dir = os.path.join(dist_assets_dir, "posters")
    dist_data_dir = os.path.join(DIST_DIR, "data")

    os.makedirs(dist_posters_dir, exist_ok=True)
    os.makedirs(dist_data_dir, exist_ok=True)
    print(f"[2/6] Prepared target output structure at: {DIST_DIR}")

    # Step 3: Copy runtime web assets
    runtime_files = ["index.html", "styles.css", "app.js"]
    for rf in runtime_files:
        src = os.path.join(BASE_DIR, rf)
        dst = os.path.join(DIST_DIR, rf)
        if not os.path.exists(src):
            raise FileNotFoundError(f"Required runtime file missing: {src}")
        shutil.copy2(src, dst)
    print(f"[3/6] Installed core frontend runtime assets ({len(runtime_files)} files).")

    # Step 4: Export compliant catalogue chunks into dist/data
    print(f"[4/6] Partitioning catalog into Cloudflare-compliant static chunks (<25 MiB)...")
    chunk_summary = export_catalog_chunks(master_records, dist_data_dir, num_chunks=4, write_monolithic=True)
    print(f"  Exported {chunk_summary['totalRecords']:,} records across {chunk_summary['chunkCount']} chunks.")
    for fname, size_b, count in chunk_summary["files"]:
        print(f"  - {fname}: {size_b / (1024*1024):.2f} MiB ({count:,} records)")

    # Step 5: Transfer / link posters
    print(f"[5/6] Syncing poster artwork library...")
    poster_files = [f for f in os.listdir(POSTERS_SRC_DIR) if os.path.isfile(os.path.join(POSTERS_SRC_DIR, f))]
    for pf in poster_files:
        src = os.path.join(POSTERS_SRC_DIR, pf)
        dst = os.path.join(dist_posters_dir, pf)
        link_or_copy(src, dst)
    print(f"  Synced {len(poster_files):,} poster files into dist/assets/posters/")

    # Step 6: Configure Cloudflare edge caching headers & ensure clean SPA routing
    # Note: SPA fallback is natively handled by Workers Static Assets via
    # `not_found_handling: "single-page-application"` in wrangler.jsonc.
    # Cloudflare code 100324 explicitly rejects catch-all `/* /index.html 200` in _redirects
    # as an infinite redirect loop with .html stripping.
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
    print(f"[6/6] Configured Cloudflare edge performance _headers (SPA handled via wrangler.jsonc).")

    # =========================================================================
    # Step 7: Comprehensive Production Asset Audit & Verification
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
        "external-movie-reconciliation.json", "catalog_data.js" # monolithic 49MB js file must not be in dist
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
    print("=" * 70)
    return True

if __name__ == "__main__":
    try:
        build_production_distribution()
    except Exception as e:
        print(f"\n[ERROR] Build aborted: {e}")
        sys.exit(1)
