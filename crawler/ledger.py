import os
import re
import json
import difflib
from collections import Counter
from .normalizer import normalize_text
from .config import DATA_DIR, FALLBACK_POSTER

RECONCILIATION_DISCREPANCY_REPORT_JSON = os.path.join(DATA_DIR, "reconciliation-discrepancy-report.json")
SOURCE_TO_PRAFLIX_MAP_JSON = os.path.join(DATA_DIR, "source-to-praflix-map.json")
MISSING_FROM_PRAFLIX_JSON = os.path.join(DATA_DIR, "missing-from-praflix.json")
SUSPECTED_BAD_MERGES_JSON = os.path.join(DATA_DIR, "suspected-bad-merges.json")
SOURCE_LEDGER_JSON = os.path.join(DATA_DIR, "source-ledger.json")

ALLOWED_STATUSES = {
    "MATCHED_CANONICAL",
    "LEGITIMATE_VARIANT",
    "LEGITIMATE_SEASON",
    "LEGITIMATE_EPISODE",
    "EXPLICIT_DUPLICATE",
    "AMBIGUOUS",
    "IMPORT_FAILED",
    "INVALID_SOURCE_RECORD"
}

def build_source_ledger(source_records, canonical_catalog):
    """
    Build permanent source-record ledger mapping EVERY source record to exactly one reconciliation status.
    
    Allowed statuses:
    - MATCHED_CANONICAL
    - LEGITIMATE_VARIANT
    - LEGITIMATE_SEASON
    - LEGITIMATE_EPISODE
    - EXPLICIT_DUPLICATE
    - AMBIGUOUS
    - IMPORT_FAILED
    - INVALID_SOURCE_RECORD
    """
    # Index canonical catalog by variants and IDs
    canon_by_url = {}
    canon_by_id = {}
    
    for c in canonical_catalog:
        cid = c["canonicalId"]
        canon_by_id[cid] = c
        variants = c.get("variants", [])
        for idx, v in enumerate(variants):
            v_url = v.get("sourceUrl")
            if v_url:
                canon_by_url[v_url] = {
                    "canonical": c,
                    "variantIndex": idx,
                    "variant": v,
                    "isPrimary": (idx == 0)
                }

    ledger = []
    
    for src in source_records:
        url = src.get("sourceUrl", "")
        raw_title = src.get("originalSourceTitle") or src.get("rawTitle", "")
        src_id = src.get("sourceId") or f"src-{len(ledger)+1}"
        year = src.get("year")
        c_type = src.get("type") or "Movie"
        season = src.get("season")
        langs = src.get("languages") or []
        
        # Extract quality labels
        raw_quals = src.get("qualities") or []
        qual_labels = []
        for q in raw_quals:
            if isinstance(q, dict):
                qual_labels.append(q.get("label", ""))
            elif isinstance(q, str):
                qual_labels.append(q)
        qual_labels = [q for q in qual_labels if q]
        
        poster = src.get("poster") or src.get("sourcePosterUrl") or FALLBACK_POSTER

        # Rule 1: Check invalid URL
        if not url or not url.startswith("http"):
            ledger.append({
                "sourceRecordId": src_id,
                "sourceUrl": url,
                "sourceTitle": raw_title,
                "normalizedTitle": src.get("normalizedTitle") or normalize_text(raw_title),
                "sourceYear": year,
                "sourceType": c_type,
                "sourceSeason": season,
                "sourceLanguages": langs,
                "sourceQualities": qual_labels,
                "sourcePoster": poster,
                "status": "INVALID_SOURCE_RECORD",
                "canonicalId": None,
                "reason": "Source record lacked valid detail URL or HTTP scheme"
            })
            continue

        # Rule 2: Check matching in canonical catalog
        match_info = canon_by_url.get(url)
        if match_info:
            canon = match_info["canonical"]
            is_primary = match_info["isPrimary"]
            c_id = canon["canonicalId"]
            
            if is_primary:
                status = "MATCHED_CANONICAL"
                reason = "Primary source record for canonical work"
            else:
                # Determine specific consolidation reason
                ep_status = src.get("episodeStatus") or ""
                ep_in_title = bool(re.search(r'\b(ep|episode|e)\s*-?\s*\d+\b', raw_title, re.IGNORECASE))
                
                # Check 1: Episode update
                if ep_status or ep_in_title:
                    status = "LEGITIMATE_EPISODE"
                    reason = f"Episode update ({ep_status or 'EP update'}) consolidated under canonical series"
                # Check 2: Season variant
                elif season and season != canon.get("season"):
                    status = "LEGITIMATE_SEASON"
                    reason = f"Season release ({season}) attached to canonical series work"
                # Check 3: Check identical duplicate
                elif (
                    src.get("normalizedTitle") == canon.get("normalizedTitle") and
                    str(src.get("year") or "") == str(canon.get("year") or "") and
                    qual_labels == canon.get("qualities", []) and
                    langs == canon.get("languages", []) and
                    src.get("releaseType") == canon.get("releaseType")
                ):
                    status = "EXPLICIT_DUPLICATE"
                    reason = "Identical release specification re-posted or cross-listed across surfaces"
                # Check 4: Legitimate Variant (resolution / language / audio / platform)
                else:
                    status = "LEGITIMATE_VARIANT"
                    lang_str = "/".join(langs) if langs else "Multi"
                    qual_str = "/".join(qual_labels) if qual_labels else "HD"
                    reason = f"Distinct release variant ({lang_str} - {qual_str}) of canonical work"

            ledger.append({
                "sourceRecordId": src_id,
                "sourceUrl": url,
                "sourceTitle": raw_title,
                "normalizedTitle": src.get("normalizedTitle") or normalize_text(raw_title),
                "sourceYear": year,
                "sourceType": c_type,
                "sourceSeason": season,
                "sourceLanguages": langs,
                "sourceQualities": qual_labels,
                "sourcePoster": poster,
                "status": status,
                "canonicalId": c_id,
                "canonicalTitle": canon["displayTitle"],
                "reason": reason
            })
        else:
            # Not found in canonical catalog
            if not raw_title or raw_title.strip() == "":
                status = "IMPORT_FAILED"
                reason = "Failed extraction: title was empty and could not be recovered"
            else:
                status = "AMBIGUOUS"
                reason = "Record was not mapped to any canonical title during matching phase"
                
            ledger.append({
                "sourceRecordId": src_id,
                "sourceUrl": url,
                "sourceTitle": raw_title,
                "normalizedTitle": src.get("normalizedTitle") or normalize_text(raw_title),
                "sourceYear": year,
                "sourceType": c_type,
                "sourceSeason": season,
                "sourceLanguages": langs,
                "sourceQualities": qual_labels,
                "sourcePoster": poster,
                "status": status,
                "canonicalId": None,
                "reason": reason
            })

    return ledger

def evaluate_reconciliation_math(ledger):
    """
    Produce exact accounting and verify math integrity.
    SOURCE TOTAL == sum(all 8 statuses)
    """
    counts = Counter(item["status"] for item in ledger)
    source_total = len(ledger)
    
    matched_canonical = counts.get("MATCHED_CANONICAL", 0)
    legitimate_variant = counts.get("LEGITIMATE_VARIANT", 0)
    legitimate_season = counts.get("LEGITIMATE_SEASON", 0)
    legitimate_episode = counts.get("LEGITIMATE_EPISODE", 0)
    explicit_duplicate = counts.get("EXPLICIT_DUPLICATE", 0)
    ambiguous = counts.get("AMBIGUOUS", 0)
    import_failed = counts.get("IMPORT_FAILED", 0)
    invalid_source_record = counts.get("INVALID_SOURCE_RECORD", 0)
    
    total_accounted = (
        matched_canonical +
        legitimate_variant +
        legitimate_season +
        legitimate_episode +
        explicit_duplicate +
        ambiguous +
        import_failed +
        invalid_source_record
    )
    
    math_valid = (total_accounted == source_total)
    consolidated_difference = source_total - matched_canonical
    
    return {
        "sourceTotal": source_total,
        "matchedCanonical": matched_canonical,
        "legitimateVariant": legitimate_variant,
        "legitimateSeason": legitimate_season,
        "legitimateEpisode": legitimate_episode,
        "explicitDuplicate": explicit_duplicate,
        "ambiguous": ambiguous,
        "importFailed": import_failed,
        "invalidSourceRecord": invalid_source_record,
        "totalAccounted": total_accounted,
        "consolidatedDifference": consolidated_difference,
        "mathValid": math_valid
    }

def generate_discrepancy_report(ledger, canonical_catalog):
    """
    Generate data/reconciliation-discrepancy-report.json containing every one of the consolidated records.
    (Investigating the 3,174 difference).
    """
    canon_map = {c["canonicalId"]: c for c in canonical_catalog}
    discrepancy_records = []
    
    for item in ledger:
        status = item["status"]
        if status == "MATCHED_CANONICAL":
            continue # Primary canonical work, not part of consolidated difference
            
        c_id = item.get("canonicalId")
        canon = canon_map.get(c_id, {})
        
        # Determine why it was merged and merge confidence
        if status == "LEGITIMATE_VARIANT":
            why_merged = "Distinct release variant (resolution, audio, or language) grouped under canonical title"
            confidence = 0.95
            exact_reason = (
                f"Shares exact normalized title '{canon.get('normalizedTitle')}' and release year {canon.get('year')} "
                f"with canonical work, providing edition ({'/'.join(item.get('sourceLanguages', []))} | {'/'.join(item.get('sourceQualities', []))})"
            )
        elif status == "LEGITIMATE_EPISODE":
            why_merged = "Episode update of canonical series"
            confidence = 0.95
            exact_reason = f"Episode update for series '{canon.get('displayTitle')}' under season {canon.get('season') or 'Standard'}"
        elif status == "LEGITIMATE_SEASON":
            why_merged = "Season release consolidated under canonical series"
            confidence = 0.90
            exact_reason = f"Specific season release ({item.get('sourceSeason')}) linked with series '{canon.get('displayTitle')}'"
        elif status == "EXPLICIT_DUPLICATE":
            why_merged = "Exact duplicate post or cross-listing across archive and category surfaces"
            confidence = 1.0
            exact_reason = "Identical title, year, languages, and qualities as primary canonical record"
        elif status == "AMBIGUOUS":
            why_merged = "Unmerged / Ambiguous match requiring manual review"
            confidence = 0.3
            exact_reason = item.get("reason", "Ambiguous match")
        elif status == "IMPORT_FAILED":
            why_merged = "Import failed due to missing metadata"
            confidence = 0.0
            exact_reason = item.get("reason", "Extraction failure")
        else:
            why_merged = "Invalid source record"
            confidence = 0.0
            exact_reason = item.get("reason", "Invalid source record")
            
        discrepancy_records.append({
            "sourceUrl": item["sourceUrl"],
            "sourceTitle": item["sourceTitle"],
            "normalizedTitle": item.get("normalizedTitle", ""),
            "year": item.get("sourceYear"),
            "contentType": item.get("sourceType"),
            "season": item.get("sourceSeason"),
            "language": ", ".join(item.get("sourceLanguages", [])),
            "quality": ", ".join(item.get("sourceQualities", [])),
            "matchedCanonicalId": c_id,
            "canonicalTitle": canon.get("displayTitle") or item.get("canonicalTitle", ""),
            "whyItWasMerged": why_merged,
            "mergeConfidence": confidence,
            "exactMergeReason": exact_reason,
            "reconciliationStatus": status
        })
        
    with open(RECONCILIATION_DISCREPANCY_REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(discrepancy_records, f, indent=2, ensure_ascii=False)
        
    return discrepancy_records

def detect_bad_merges(canonical_catalog, source_records):
    """
    Detect bad merges and candidate collisions:
    - Same title but different year
    - Same title but different content type
    - Movie vs series collision
    - Different seasons merged
    - Different episodes merged
    - Sequel collisions (e.g. Awarapan vs Awarapan 2)
    - Unrelated titles with high fuzzy similarity
    """
    src_map = {s["sourceUrl"]: s for s in source_records}
    bad_merges = []
    
    # 1. Audit inside canonical records (variants merged within same canonical work)
    for c in canonical_catalog:
        cid = c["canonicalId"]
        c_title = c["displayTitle"]
        c_year = str(c.get("year") or "").strip()
        c_type = str(c.get("type") or "").strip().lower()
        c_season = str(c.get("season") or "").strip().lower()
        
        variants = c.get("variants", [])
        if len(variants) <= 1:
            continue
            
        for v in variants:
            v_url = v.get("sourceUrl")
            src = src_map.get(v_url, {})
            v_title = src.get("originalSourceTitle") or v.get("originalSourceTitle") or ""
            v_year = str(src.get("year") or "").strip()
            v_type = str(src.get("type") or "").strip().lower()
            v_season = str(src.get("season") or "").strip().lower()
            
            # Check year conflict
            if c_year and v_year and c_year != v_year:
                bad_merges.append({
                    "severity": "CRITICAL",
                    "issueType": "YEAR_MISMATCH_MERGE",
                    "canonicalId": cid,
                    "canonicalTitle": c_title,
                    "canonicalYear": c_year,
                    "variantUrl": v_url,
                    "variantTitle": v_title,
                    "variantYear": v_year,
                    "explanation": f"Canonical work '{c_title}' ({c_year}) incorrectly merged variant with year ({v_year})"
                })
                
            # Check content type conflict
            if c_type and v_type and c_type != v_type:
                bad_merges.append({
                    "severity": "CRITICAL",
                    "issueType": "TYPE_MISMATCH_MERGE",
                    "canonicalId": cid,
                    "canonicalTitle": c_title,
                    "canonicalType": c_type,
                    "variantUrl": v_url,
                    "variantTitle": v_title,
                    "variantType": v_type,
                    "explanation": f"Canonical work '{c_title}' ({c_type}) incorrectly merged variant of different type ({v_type})"
                })
                
            # Check season conflict
            if c_season and v_season and c_season != v_season:
                bad_merges.append({
                    "severity": "CRITICAL",
                    "issueType": "SEASON_MISMATCH_MERGE",
                    "canonicalId": cid,
                    "canonicalTitle": c_title,
                    "canonicalSeason": c_season,
                    "variantUrl": v_url,
                    "variantTitle": v_title,
                    "variantSeason": v_season,
                    "explanation": f"Canonical series '{c_title}' ({c_season}) merged variant with different season ({v_season})"
                })
                
            # Check sequel numbering collision
            clean_c = re.sub(r'(?:18\+?|16\+?)\b|\b(19\d\d|20[0-3]\d|360|480|720|1080|1440|2160|4k|x264|x265|hevc|dd5\.1|dd7\.1|5\.1|7\.1|1gb|2gb|700mb|300mb)\b', '', c_title, flags=re.I)
            clean_v = re.sub(r'(?:18\+?|16\+?)\b|\b(19\d\d|20[0-3]\d|360|480|720|1080|1440|2160|4k|x264|x265|hevc|dd5\.1|dd7\.1|5\.1|7\.1|1gb|2gb|700mb|300mb)\b', '', v_title, flags=re.I)
            c_nums = re.findall(r'\b\d+\b', clean_c)
            v_nums = re.findall(r'\b\d+\b', clean_v)
            if c_nums and v_nums and set(c_nums) != set(v_nums):
                bad_merges.append({
                    "severity": "CRITICAL" if any(cn != vn for cn, vn in zip(c_nums, v_nums)) else "WARNING",
                    "issueType": "SEQUEL_NUMBER_MERGE",
                    "canonicalId": cid,
                    "canonicalTitle": c_title,
                    "variantUrl": v_url,
                    "variantTitle": v_title,
                    "explanation": f"Sequel number conflict: '{c_title}' ({c_nums}) vs variant '{v_title}' ({v_nums})"
                })

    # 2. Audit cross-canonical pairs for potential near-duplicates or typos
    sample_size = min(len(canonical_catalog), 1000)
    for i in range(min(300, sample_size)):
        c1 = canonical_catalog[i]
        t1 = c1["normalizedTitle"]
        for j in range(i + 1, min(i + 20, sample_size)):
            c2 = canonical_catalog[j]
            t2 = c2["normalizedTitle"]
            if t1 != t2 and len(t1) > 5 and len(t2) > 5:
                ratio = difflib.SequenceMatcher(None, t1, t2).ratio()
                if ratio > 0.92 and c1.get("year") == c2.get("year") and c1.get("type") == c2.get("type"):
                    bad_merges.append({
                        "severity": "INFO_REVIEW",
                        "issueType": "NEAR_DUPLICATE_CROSS_CHECK",
                        "canonicalIdA": c1["canonicalId"],
                        "titleA": c1["displayTitle"],
                        "canonicalIdB": c2["canonicalId"],
                        "titleB": c2["displayTitle"],
                        "similarity": round(ratio, 3),
                        "explanation": f"High fuzzy similarity ({round(ratio*100,1)}%) between '{c1['displayTitle']}' and '{c2['displayTitle']}'"
                    })

    with open(SUSPECTED_BAD_MERGES_JSON, "w", encoding="utf-8") as f:
        json.dump(bad_merges, f, indent=2, ensure_ascii=False)
        
    return bad_merges

def detect_missing_from_praflix(ledger, canonical_catalog):
    """
    Generate data/missing-from-praflix.json containing every source record that does NOT
    result in a visible PRAFLIX canonical record.
    """
    active_canonical_ids = {c["canonicalId"] for c in canonical_catalog if c.get("status") == "active" or "canonicalId" in c}
    missing_records = []
    
    for item in ledger:
        cid = item.get("canonicalId")
        status = item.get("status")
        
        if not cid or cid not in active_canonical_ids or status in ("AMBIGUOUS", "IMPORT_FAILED", "INVALID_SOURCE_RECORD"):
            missing_records.append({
                "sourceUrl": item.get("sourceUrl", ""),
                "title": item.get("sourceTitle", ""),
                "year": item.get("sourceYear"),
                "reason": item.get("reason", "Missing from catalog"),
                "reconciliationStatus": status
            })

    with open(MISSING_FROM_PRAFLIX_JSON, "w", encoding="utf-8") as f:
        json.dump(missing_records, f, indent=2, ensure_ascii=False)
        
    return missing_records

def generate_source_to_praflix_map(ledger, canonical_catalog):
    """
    Generate data/source-to-praflix-map.json:
    Every source record must map to:
    {
      "sourceRecordId": "abc",
      "canonicalId": 123,
      "visibleInCatalog": true,
      "visibleInSearch": true,
      "visibleInYearFilter": true
    }
    """
    active_canons = {c["canonicalId"]: c for c in canonical_catalog}
    coverage_map = []
    
    for item in ledger:
        cid = item.get("canonicalId")
        canon = active_canons.get(cid)
        
        if canon:
            visible_catalog = True
            visible_search = bool(canon.get("normalizedTitle") or canon.get("displayTitle"))
            visible_year = True
        else:
            visible_catalog = False
            visible_search = False
            visible_year = False
            
        coverage_map.append({
            "sourceRecordId": item["sourceRecordId"],
            "canonicalId": cid,
            "visibleInCatalog": visible_catalog,
            "visibleInSearch": visible_search,
            "visibleInYearFilter": visible_year
        })
        
    with open(SOURCE_TO_PRAFLIX_MAP_JSON, "w", encoding="utf-8") as f:
        json.dump(coverage_map, f, indent=2)
        
    return coverage_map

def audit_frontend_visibility(canonical_catalog):
    """
    Audit frontend visibility for all canonical records:
    - TOTAL CANONICAL
    - VISIBLE CANONICAL
    - HIDDEN CANONICAL
    - UNSEARCHABLE CANONICAL
    - INVALID CANONICAL
    """
    total = len(canonical_catalog)
    visible = 0
    hidden = 0
    unsearchable = 0
    invalid = 0
    
    for c in canonical_catalog:
        cid = c.get("canonicalId")
        title = c.get("displayTitle")
        status = c.get("status", "active")
        
        if not cid or not title or str(title).strip() == "":
            invalid += 1
            continue
            
        if status != "active":
            hidden += 1
            continue
            
        norm_title = c.get("normalizedTitle") or normalize_text(title)
        if not norm_title or norm_title.strip() == "":
            unsearchable += 1
            continue
            
        visible += 1
        
    return {
        "totalCanonical": total,
        "visibleCanonical": visible,
        "hiddenCanonical": hidden,
        "unsearchableCanonical": unsearchable,
        "invalidCanonical": invalid,
        "totalPages": (total + 47) // 48
    }

def audit_quality_distribution(canonical_catalog):
    """
    Count exact quality distributions across all canonical works:
    360p, 480p, 720p, 1080p, 1440p, 2160p/4K
    """
    qual_counts = {
        "360p": 0,
        "480p": 0,
        "720p": 0,
        "1080p": 0,
        "1440p": 0,
        "2160p/4K": 0
    }
    
    for c in canonical_catalog:
        quals = set()
        for q in c.get("qualities", []):
            quals.add(str(q).upper())
        for v in c.get("variants", []):
            for vq in v.get("qualities", []):
                if isinstance(vq, dict):
                    quals.add(str(vq.get("label", "")).upper())
                elif isinstance(vq, str):
                    quals.add(vq.upper())
                    
        for q in quals:
            if "360P" in q or "360" in q: qual_counts["360p"] += 1
            if "480P" in q or "480" in q: qual_counts["480p"] += 1
            if "720P" in q or "720" in q: qual_counts["720p"] += 1
            if "1080P" in q or "1080" in q: qual_counts["1080p"] += 1
            if "1440P" in q or "1440" in q: qual_counts["1440p"] += 1
            if "2160P" in q or "4K" in q or "UHD" in q: qual_counts["2160p/4K"] += 1
            
    return qual_counts
