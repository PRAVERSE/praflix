"""
PRAFLIX — A PRAVERSE Company
Cloudflare Production Asset Audit & Deployment Regression Suite

Validates that the production distribution (`dist`) strictly adheres to:
1. Cloudflare 25 MiB individual asset size limit across all files.
2. Cloudflare Pages 20,000 file count ceiling.
3. 100% complete catalogue data fidelity (all 15,433 canonical titles).
4. Full metadata and artwork integrity across Movies, Series, Categories, and Routes.
5. Clean isolation: No source data, crawler scripts, or test artifacts leaked to dist.
"""

import os
import sys
import json
import re
import unittest

sys.stdout.reconfigure(encoding='utf-8')

MAX_CLOUDFLARE_FILE_BYTES = 25 * 1024 * 1024  # 26,214,400 bytes
MAX_CLOUDFLARE_FILE_COUNT = 20000

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(BASE_DIR, "dist")
DATA_DIR = os.path.join(BASE_DIR, "data")
MASTER_CATALOG_JSON = os.path.join(DATA_DIR, "catalog.json")

class TestCloudflareProductionAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(MASTER_CATALOG_JSON, "r", encoding="utf-8") as f:
            cls.master_catalog = json.load(f)

    def test_01_dist_directory_structure(self):
        """Verify dist exists with core runtime assets and proper hierarchy."""
        self.assertTrue(os.path.exists(DIST_DIR), "dist directory must exist")
        self.assertTrue(os.path.exists(os.path.join(DIST_DIR, "index.html")), "dist/index.html must exist")
        self.assertTrue(os.path.exists(os.path.join(DIST_DIR, "styles.css")), "dist/styles.css must exist")
        self.assertTrue(os.path.exists(os.path.join(DIST_DIR, "app.js")), "dist/app.js must exist")
        self.assertTrue(os.path.exists(os.path.join(DIST_DIR, "assets", "posters")), "dist/assets/posters must exist")
        self.assertTrue(os.path.exists(os.path.join(DIST_DIR, "data")), "dist/data must exist")

    def test_02_cloudflare_individual_asset_size_limit(self):
        """Check EVERY file in dist recursively against Cloudflare 25 MiB limit."""
        oversized = []
        total_files = 0
        total_bytes = 0
        largest = ("", 0)

        for root, dirs, files in os.walk(DIST_DIR):
            for f in files:
                total_files += 1
                fpath = os.path.join(root, f)
                fsize = os.path.getsize(fpath)
                total_bytes += fsize

                if fsize > largest[1]:
                    largest = (os.path.relpath(fpath, DIST_DIR), fsize)

                if fsize > MAX_CLOUDFLARE_FILE_BYTES:
                    oversized.append((os.path.relpath(fpath, DIST_DIR), fsize))

        self.assertEqual(len(oversized), 0, f"Found files exceeding 25 MiB: {oversized}")
        self.assertLessEqual(total_files, MAX_CLOUDFLARE_FILE_COUNT, f"File count {total_files} exceeds {MAX_CLOUDFLARE_FILE_COUNT}")
        print(f"\n[Audit] Scanned {total_files:,} production assets. Largest: {largest[0]} ({largest[1] / (1024*1024):.2f} MiB)")

    def test_03_catalog_chunks_integrity(self):
        """Verify all catalogue chunks exist in dist and reconstruct exactly 15,433 records."""
        manifest_path = os.path.join(DIST_DIR, "data", "catalog-manifest.json")
        self.assertTrue(os.path.exists(manifest_path), "catalog-manifest.json must exist in dist/data")

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        self.assertEqual(manifest.get("totalRecords"), 15433)
        self.assertEqual(len(manifest.get("chunks", [])), 4)

        reconstructed = []
        for cpath in manifest["chunks"]:
            full_cpath = os.path.join(DIST_DIR, cpath)
            self.assertTrue(os.path.exists(full_cpath), f"Chunk file {cpath} must exist in dist")
            # Size check
            self.assertLess(os.path.getsize(full_cpath), MAX_CLOUDFLARE_FILE_BYTES, f"Chunk {cpath} exceeds 25 MiB")
            with open(full_cpath, "r", encoding="utf-8") as cf:
                chunk_data = json.load(cf)
                reconstructed.extend(chunk_data)

        self.assertEqual(len(reconstructed), len(self.master_catalog))
        self.assertEqual(reconstructed, self.master_catalog, "Reconstructed catalog records must match master catalog with 100% fidelity")

    def test_04_catalog_js_chunks_integrity(self):
        """Verify JS chunk scripts exist in dist/data and aggregate all 15,433 records without exceeding 25 MiB."""
        js_chunks = [
            "catalog_chunk_1.js", "catalog_chunk_2.js",
            "catalog_chunk_3.js", "catalog_chunk_4.js"
        ]
        total_records_in_js = 0
        for jf in js_chunks:
            jpath = os.path.join(DIST_DIR, "data", jf)
            self.assertTrue(os.path.exists(jpath), f"{jf} must exist in dist/data")
            self.assertLess(os.path.getsize(jpath), MAX_CLOUDFLARE_FILE_BYTES, f"{jf} exceeds 25 MiB limit")
            with open(jpath, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn("window.PRAFLIX_DATA", content)
                m = re.search(r'concat\((\[.*?\])\);', content)
                self.assertIsNotNone(m, f"Could not find JSON payload in {jf}")
                records = json.loads(m.group(1))
                total_records_in_js += len(records)

        self.assertEqual(total_records_in_js, 15433, "All 15,433 records must be represented across JS chunks")

    def test_05_clean_production_isolation(self):
        """Ensure no development, test, crawler, raw source, or oversized audit files leaked into dist."""
        forbidden_names = [
            "catalog-normalized.json",
            "catalog_data.js",
            "source-records.json",
            "source-inventory.json",
            "source-ledger.json",
            "master_url_inventory.json",
            "sync-state.json",
            "external-movie-reconciliation.json",
            "vegamovies_raw.json",
            "vegamovies_sources.json",
            "crawl-audit.json",
            "reconciliation-discrepancy-report.json"
        ]
        for name in forbidden_names:
            path_in_dist = os.path.join(DIST_DIR, "data", name)
            self.assertFalse(os.path.exists(path_in_dist), f"Forbidden non-runtime file found in dist/data: {name}")

        # Check for python files in dist
        for root, dirs, files in os.walk(DIST_DIR):
            for f in files:
                self.assertFalse(f.endswith(".py"), f"Python file leaked to dist: {f}")
                self.assertFalse(f.endswith(".pyc"), f"Pyc file leaked to dist: {f}")

    def test_06_cloudflare_configuration_files(self):
        """Verify wrangler.jsonc, _redirects, and _headers are configured for dist."""
        wrangler_path = os.path.join(BASE_DIR, "wrangler.jsonc")
        self.assertTrue(os.path.exists(wrangler_path), "wrangler.jsonc must exist in project root")

        with open(wrangler_path, "r", encoding="utf-8") as f:
            wrangler_text = f.read()

        self.assertIn('"directory": "./dist"', wrangler_text, "wrangler.jsonc must point assets directory to ./dist")
        self.assertIn('"not_found_handling": "single-page-application"', wrangler_text, "SPA fallback must be handled via wrangler.jsonc")
        # Ensure no reserved binding error triggers
        self.assertNotIn('"binding"', wrangler_text, "Assets-only Worker must not specify a binding")
        self.assertNotIn('"pages_build_output_dir"', wrangler_text, "Workers configuration must not mix pages_build_output_dir")

        # Regression check for Cloudflare error [code: 100324]
        # Any catch-all redirect to /index.html in _redirects causes an infinite loop in Cloudflare
        redirects_path = os.path.join(DIST_DIR, "_redirects")
        if os.path.exists(redirects_path):
            with open(redirects_path, "r", encoding="utf-8") as f:
                redirect_lines = f.readlines()
            for line in redirect_lines:
                clean = line.strip()
                if not clean or clean.startswith("#"):
                    continue
                parts = clean.split()
                if len(parts) >= 2:
                    src, dst = parts[0], parts[1]
                    self.assertNotEqual(src, dst, f"Infinite loop / self-redirect detected in _redirects: {clean}")
                    self.assertFalse(src == "/*" and (dst == "/index.html" or dst == "/"),
                                     f"Catch-all SPA infinite loop detected (Cloudflare code 100324): {clean}")

        headers_path = os.path.join(DIST_DIR, "_headers")
        self.assertTrue(os.path.exists(headers_path), "_headers must exist in dist")

    def test_07_posters_and_artwork_preservation(self):
        """Verify poster artwork library is intact in dist with fallback svg."""
        dist_posters_dir = os.path.join(DIST_DIR, "assets", "posters")
        fallback_svg = os.path.join(dist_posters_dir, "fallback.svg")
        self.assertTrue(os.path.exists(fallback_svg), "fallback.svg must exist in dist/assets/posters")

        poster_count = len([f for f in os.listdir(dist_posters_dir) if f.endswith(".jpg") or f.endswith(".png") or f.endswith(".webp") or f.endswith(".svg")])
        self.assertGreaterEqual(poster_count, 8880, f"Expected ~8,882 poster files in dist, found {poster_count}")

    def test_08_key_title_and_route_regression(self):
        """Verify critical regression titles, movies, series, and categories are intact."""
        titles = {c.get("displayTitle", "").lower(): c for c in self.master_catalog}

        self.assertIn("12th fail", titles, "12th Fail must be present")
        self.assertEqual(titles["12th fail"]["year"], "2023")
        self.assertEqual(titles["12th fail"]["type"], "Movie")

        self.assertIn("sacred games", titles, "Sacred Games must be present")
        self.assertEqual(titles["sacred games"]["type"], "Web Series")

        self.assertIn("the paradise", titles, "The Paradise must be present")
        self.assertEqual(titles["the paradise"]["year"], "2026")

        self.assertIn("awarapan 2", titles, "Awarapan 2 must be present")
        self.assertEqual(titles["awarapan 2"]["year"], "2026")

    def test_09_redirect_rules_regression_no_infinite_loops(self):
        """Ensure no redirect rule causes Cloudflare 100324 infinite loop error."""
        redirects_path = os.path.join(DIST_DIR, "_redirects")
        # Workers Static Assets handles SPA fallback via wrangler.jsonc not_found_handling
        # Any catch-all or self-referential redirect rule is strictly forbidden
        if os.path.exists(redirects_path):
            with open(redirects_path, "r", encoding="utf-8") as f:
                content = f.read()
            # Explicit regression checks:
            self.assertNotIn("/* /index.html", content)
            self.assertNotIn("/*   /index.html", content)
            self.assertNotIn("/* / 200", content)
            self.assertNotIn("/ / 200", content)

    def test_10_spa_routing_and_static_files_integrity(self):
        """Ensure dist contains valid index.html entrypoint and static assets for SPA routing."""
        index_path = os.path.join(DIST_DIR, "index.html")
        self.assertTrue(os.path.exists(index_path), "dist/index.html must exist for SPA fallback")

        # Verify index.html contains SPA root and router scripts
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()
        self.assertIn("PRAFLIX", html)
        self.assertIn("app.js", html)
        self.assertIn("styles.css", html)

        # Check catalog manifest or chunk files exist
        manifest_path = os.path.join(DIST_DIR, "data", "catalog-manifest.json")
        self.assertTrue(os.path.exists(manifest_path), "catalog-manifest.json must exist in dist/data")

if __name__ == "__main__":
    unittest.main()

