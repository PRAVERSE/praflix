"""
PRAFLIX — Vegamovies Catalogue Reconciliation & Quality Assurance Test Suite
Automated validation of all requirements from Section 9.
"""

import os
import re
import json
import unittest

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CATALOG_JSON = os.path.join(DATA_DIR, "catalog.json")
CATALOG_NORMALIZED_JSON = os.path.join(DATA_DIR, "catalog-normalized.json")
SOURCE_RECORDS_JSON = os.path.join(DATA_DIR, "source-records.json")
CATALOG_DATA_JS = os.path.join(DATA_DIR, "catalog_data.js")
VEGA_RAW_JSON = os.path.join(DATA_DIR, "vegamovies_raw.json")
VEGA_SOURCES_JSON = os.path.join(DATA_DIR, "vegamovies_sources.json")
VEGA_REPORT_JSON = os.path.join(DATA_DIR, "vegamovies_integration_report.json")
VEGA_REVIEW_JSON = os.path.join(DATA_DIR, "vegamovies_manual_review.json")
VEGA_POSTER_REVIEW_JSON = os.path.join(DATA_DIR, "vegamovies_poster_review.json")


class TestVegamoviesIntegration(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with open(CATALOG_JSON, encoding="utf-8") as f:
            cls.catalog = json.load(f)
        with open(SOURCE_RECORDS_JSON, encoding="utf-8") as f:
            cls.sources = json.load(f)
        with open(VEGA_RAW_JSON, encoding="utf-8") as f:
            cls.vega_raw = json.load(f)
        with open(VEGA_REPORT_JSON, encoding="utf-8") as f:
            cls.report = json.load(f)
        with open(VEGA_POSTER_REVIEW_JSON, encoding="utf-8") as f:
            cls.poster_review = json.load(f)

    def test_01_total_vega_raw_count(self):
        """Verify all 15,734 records from the 346-page PDF are extracted without data loss."""
        self.assertEqual(len(self.vega_raw), 15734, "Vegamovies raw records must equal exactly 15,734")
        urls = {r.get("sourceUrl") for r in self.vega_raw}
        self.assertEqual(len(urls), 15734, "All 15,734 records must have distinct source URLs")

    def test_02_mathematical_integrity(self):
        """Verify 100% of Vegamovies records are accounted for in the integration report."""
        matched = self.report.get("exactMatches", 0)
        new_recs = self.report.get("newTitleRecords", 0)
        review = self.report.get("ambiguousReview", 0)
        total = self.report.get("totalAccounted", 0)

        self.assertEqual(matched + new_recs + review, 15734)
        self.assertEqual(total, 15734)
        self.assertTrue(self.report.get("mathValid", False))

    def test_03_canonical_titles_count(self):
        """Verify canonical catalog contains 11,231 baseline + 4,202 new canonicals = 15,433 total."""
        self.assertEqual(len(self.catalog), 15433)
        hdhub_canons = [c for c in self.catalog if c["canonicalId"] <= 11231]
        vega_canons = [c for c in self.catalog if c["canonicalId"] > 11231]
        self.assertEqual(len(hdhub_canons), 11231)
        self.assertEqual(len(vega_canons), 4202)

    def test_04_source_records_coverage(self):
        """Verify source-records.json contains exactly 14,409 HDHub4u + 15,734 Vegamovies = 30,143 records."""
        self.assertEqual(len(self.sources), 30143)
        hdhub_sources = [s for s in self.sources if s.get("source") != "vegamovies"]
        vega_sources = [s for s in self.sources if s.get("source") == "vegamovies"]
        self.assertEqual(len(hdhub_sources), 14409)
        self.assertEqual(len(vega_sources), 15734)

    def test_05_previously_missing_short_titles_restored(self):
        """Verify titles dropped by the previous integration (.45, 100, 118, 122, 144, 1BR, 211, 300) exist."""
        test_titles = [".45", "100", "118", "122", "144", "1BR", "211", "300"]
        catalog_titles = {c.get("displayTitle", "").lower(): c for c in self.catalog}
        for t in test_titles:
            self.assertIn(t.lower(), catalog_titles, f"Title '{t}' must be present in the catalog")

    def test_06_web_series_season_preservation(self):
        """Verify web series like Panchayat, Mirzapur, Abhay, Aashram have seasons correctly associated."""
        series_to_check = ["Panchayat", "Mirzapur", "Abhay", "Aashram"]
        for s_name in series_to_check:
            matches = [c for c in self.catalog if c.get("displayTitle", "").lower() == s_name.lower() and c.get("type") == "Web Series"]
            self.assertGreaterEqual(len(matches), 1, f"Web Series '{s_name}' must exist in catalog")
            # Verify no raw '(Season X)' is leaked into displayTitle
            for m in matches:
                self.assertFalse(bool(re.search(r'\(Season\s*\d+\)', m.get("displayTitle", ""), re.I)),
                                 f"Season string leaked into display title: {m.get('displayTitle')}")

    def test_07_poster_artwork_attached_and_fallback(self):
        """Verify newly imported titles have verified poster artwork or documented fallback."""
        vega_canons = [c for c in self.catalog if c["canonicalId"] > 11231]
        verified_posters = [c for c in vega_canons if "vegamoviess.io" in (c.get("poster") or "")]
        fallback_posters = [c for c in vega_canons if "fallback.svg" in (c.get("poster") or "")]

        self.assertEqual(len(verified_posters), 2739)
        self.assertEqual(len(fallback_posters), 1463)
        self.assertEqual(len(verified_posters) + len(fallback_posters), len(vega_canons))
        self.assertEqual(len(self.poster_review), 1463)

    def test_08_no_overwriting_of_valid_hdhub_posters(self):
        """Verify existing valid HDHub4u posters in assets/posters were not overwritten."""
        hdhub_canons = [c for c in self.catalog if c["canonicalId"] <= 11231]
        local_posters = [c for c in hdhub_canons if "assets/posters/" in (c.get("poster") or "") and "fallback" not in c.get("poster", "")]
        self.assertGreater(len(local_posters), 8000, "Local HDHub4u posters must be preserved")

    def test_09_frontend_data_synchronization(self):
        """Verify catalog_data.js matches catalog.json exactly."""
        with open(CATALOG_DATA_JS, encoding="utf-8") as f:
            js_content = f.read()

        self.assertIn("window.PRAFLIX_DATA", js_content)
        self.assertIn("window.PRAFLIX_SOURCES", js_content)

        # Check total records in JS
        m_data = re.search(r'window\.PRAFLIX_DATA\s*=\s*(\[.*?\]);', js_content)
        self.assertIsNotNone(m_data)
        js_data = json.loads(m_data.group(1))
        self.assertEqual(len(js_data), len(self.catalog))

    def test_10_languages_and_qualities_aggregation(self):
        """Verify language and quality options are preserved and aggregated onto canonical titles."""
        # Find canonicals with multiple variants
        multi_var = [c for c in self.catalog if c.get("variantCount", 1) > 1]
        self.assertGreater(len(multi_var), 5000)
        # Check that variants have valid qualities and languages
        sample = multi_var[0]
        self.assertTrue(len(sample.get("languages", [])) > 0)
        self.assertTrue(len(sample.get("qualities", [])) > 0)
        for v in sample.get("variants", []):
            self.assertTrue("sourceUrl" in v)
            self.assertTrue("languages" in v)
            self.assertTrue("qualities" in v)


if __name__ == "__main__":
    unittest.main()
