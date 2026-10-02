#!/usr/bin/env python3
"""
PRAFLIX — A PRAVERSE Company
Catalog Reconciliation Engine
"""

import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')

from crawler.config import (
    SOURCE_RECORDS_JSON, SOURCE_INVENTORY_JSON, CATALOG_JSON,
    SOURCE_LEDGER_JSON, RECONCILIATION_REPORT_JSON,
    RECONCILIATION_DISCREPANCY_REPORT_JSON, SOURCE_TO_PRAFLIX_MAP_JSON,
    MISSING_FROM_PRAFLIX_JSON, SUSPECTED_BAD_MERGES_JSON, MISSING_RECORDS_JSON
)
from crawler.ledger import (
    build_source_ledger, evaluate_reconciliation_math,
    generate_discrepancy_report, detect_bad_merges,
    detect_missing_from_praflix, generate_source_to_praflix_map,
    audit_frontend_visibility, audit_quality_distribution
)

def main():
    print("=" * 65)
    print("PRAFLIX CATALOG RECONCILIATION SUITE")
    print("A PRAVERSE Company")
    print("=" * 65)

    source_path = SOURCE_RECORDS_JSON if os.path.exists(SOURCE_RECORDS_JSON) else SOURCE_INVENTORY_JSON
    if not os.path.exists(source_path):
        print(f"Error: {source_path} not found. Run pipeline or crawler first.")
        sys.exit(1)
    if not os.path.exists(CATALOG_JSON):
        print(f"Error: {CATALOG_JSON} not found. Run pipeline first.")
        sys.exit(1)

    with open(source_path, "r", encoding="utf-8") as f:
        source_records = json.load(f)
    with open(CATALOG_JSON, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    print(f"Loaded Source Records:   {len(source_records):,} records")
    print(f"Loaded Master Catalog:   {len(catalog):,} canonical titles")

    # 1. Build Source-Record Ledger
    print("\nBuilding Source-Record Ledger...")
    ledger = build_source_ledger(source_records, catalog)
    with open(SOURCE_LEDGER_JSON, "w", encoding="utf-8") as f:
        json.dump(ledger, f, indent=2, ensure_ascii=False)
    print(f"Saved {len(ledger):,} ledger entries to {SOURCE_LEDGER_JSON}")

    # 2. Evaluate Reconciliation Math
    math_res = evaluate_reconciliation_math(ledger)

    # 3. Discrepancy Report
    discrepancies = generate_discrepancy_report(ledger, catalog)
    print(f"Saved {len(discrepancies):,} discrepancy records to {RECONCILIATION_DISCREPANCY_REPORT_JSON}")

    # 4. Bad Merges Detector
    bad_merges = detect_bad_merges(catalog, source_records)
    critical_bad = [b for b in bad_merges if b.get("severity") == "CRITICAL"]
    print(f"Saved {len(bad_merges)} merge review items ({len(critical_bad)} critical) to {SUSPECTED_BAD_MERGES_JSON}")

    # 5. Missing Records Detector
    missing = detect_missing_from_praflix(ledger, catalog)
    print(f"Saved {len(missing)} missing items to {MISSING_FROM_PRAFLIX_JSON}")
    with open(MISSING_RECORDS_JSON, "w", encoding="utf-8") as f:
        json.dump(missing, f, indent=2)

    # 6. Coverage Map
    cov_map = generate_source_to_praflix_map(ledger, catalog)
    print(f"Saved {len(cov_map):,} coverage mappings to {SOURCE_TO_PRAFLIX_MAP_JSON}")

    # 7. Frontend Visibility Audit
    vis_audit = audit_frontend_visibility(catalog)

    # 8. Qualities
    qual_audit = audit_quality_distribution(catalog)

    # Summary Report
    report = {
        "sourceListings": math_res["sourceTotal"],
        "canonicalRecords": len(catalog),
        "matched": math_res["matchedCanonical"] + math_res["legitimateVariant"] + math_res["legitimateEpisode"] + math_res["explicitDuplicate"],
        "missing": len(missing),
        "missingCount": len(missing),
        "duplicates": math_res["explicitDuplicate"],
        "groupedVariants": math_res["legitimateVariant"] + math_res["legitimateSeason"] + math_res["legitimateEpisode"],
        "ambiguous": math_res["ambiguous"],
        "failed": math_res["importFailed"] + math_res["invalidSourceRecord"],
        "reconciliation": math_res,
        "consolidatedDifference": math_res["consolidatedDifference"],
        "badMergesCount": len(critical_bad),
        "frontendVisibility": vis_audit,
        "qualities": qual_audit
    }
    with open(RECONCILIATION_REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\n--------------------------------")
    print("RECONCILIATION MATH SUMMARY")
    print("--------------------------------")
    print(f"SOURCE TOTAL:          {math_res['sourceTotal']:,}")
    print(f"MATCHED_CANONICAL:     {math_res['matchedCanonical']:,}")
    print(f"LEGITIMATE_VARIANT:    {math_res['legitimateVariant']:,}")
    print(f"LEGITIMATE_SEASON:     {math_res['legitimateSeason']:,}")
    print(f"LEGITIMATE_EPISODE:    {math_res['legitimateEpisode']:,}")
    print(f"EXPLICIT_DUPLICATE:    {math_res['explicitDuplicate']:,}")
    print(f"AMBIGUOUS:             {math_res['ambiguous']:,}")
    print(f"IMPORT_FAILED:         {math_res['importFailed']:,}")
    print(f"INVALID_SOURCE_RECORD: {math_res['invalidSourceRecord']:,}")
    print(f"TOTAL ACCOUNTED:       {math_res['totalAccounted']:,}")
    print(f"MATH INTEGRITY:        {'PASSED' if math_res['mathValid'] else 'FAILED'}")
    print(f"CONSOLIDATED DIFF:     {math_res['consolidatedDifference']:,}")
    print("--------------------------------")
    print("=" * 65)

if __name__ == '__main__':
    main()

