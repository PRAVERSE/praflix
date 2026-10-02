import re
from .normalizer import normalize_text

def get_matching_key(record):
    """
    Generate canonical grouping key.
    Records match into the same canonical title if they share:
    - exact normalized display title
    - exact year (or both empty)
    - exact season (or both None)
    - exact content type (movie vs series)
    """
    norm_title = record.get("normalizedTitle") or normalize_text(record.get("displayTitle", ""))
    year = str(record.get("year") or "").strip()
    season = str(record.get("season") or "").strip().lower()
    content_type = str(record.get("type") or "movie").strip().lower()
    
    return (norm_title, year, season, content_type)

def evaluate_match_confidence(rec_a, rec_b):
    """
    Evaluate matching confidence level between two source records:
    - exact: same stable source detail URL
    - strong: same normalized title, same non-empty year, same season, same type
    - possible: same normalized title, but one has missing year or ambiguous subtitle
    - ambiguous: titles look similar but have different numbers (e.g. Movie A vs Movie A 2) or different years
    """
    # 1. Exact match by source detail URL
    if rec_a.get("sourceUrl") and rec_a.get("sourceUrl") == rec_b.get("sourceUrl"):
        return "exact", 1.0

    title_a = rec_a.get("normalizedTitle") or normalize_text(rec_a.get("displayTitle", ""))
    title_b = rec_b.get("normalizedTitle") or normalize_text(rec_b.get("displayTitle", ""))
    
    year_a = str(rec_a.get("year") or "").strip()
    year_b = str(rec_b.get("year") or "").strip()
    
    type_a = str(rec_a.get("type") or "movie").strip().lower()
    type_b = str(rec_b.get("type") or "movie").strip().lower()
    
    season_a = str(rec_a.get("season") or "").strip().lower()
    season_b = str(rec_b.get("season") or "").strip().lower()

    # Rule: If years are both present and different -> NEVER merge, ambiguous/different
    if year_a and year_b and year_a != year_b:
        return "ambiguous", 0.1

    # Rule: If seasons are different -> NEVER merge
    if season_a != season_b:
        return "ambiguous", 0.1

    # Rule: If types are different -> NEVER merge
    if type_a != type_b:
        return "ambiguous", 0.1

    # Rule: Sequel numbering check (e.g. Awarapan vs Awarapan 2)
    num_a = re.findall(r'\b\d+\b', title_a)
    num_b = re.findall(r'\b\d+\b', title_b)
    if num_a != num_b:
        return "ambiguous", 0.2

    # Check title equality
    if title_a == title_b:
        if year_a and year_b and year_a == year_b:
            return "strong", 0.95
        else:
            return "possible", 0.75

    return "ambiguous", 0.3

def group_canonical_records(normalized_records):
    """
    Group normalized source records into canonical titles with variants.
    Maintains all source listings inside 'variants' array.
    """
    canonical_map = {}
    ambiguous_records = []
    
    for rec in normalized_records:
        key = get_matching_key(rec)
        if not key[0]: # Empty normalized title
            ambiguous_records.append({
                "record": rec,
                "reason": "EMPTY_NORMALIZED_TITLE"
            })
            continue
            
        if key not in canonical_map:
            canonical_map[key] = []
        canonical_map[key].append(rec)
        
    canonical_titles = []
    canonical_id = 1
    
    # Sort deterministically: newest year first, then title A-Z
    def sort_key(item):
        k = item[0]
        y_str = k[1]
        y_val = int(y_str) if (y_str and y_str.isdigit()) else 0
        return (-y_val, k[0])
        
    for key, variants in sorted(canonical_map.items(), key=sort_key):
        first = variants[0]
        
        all_langs = []
        all_quals = []
        all_audios = []
        all_platforms = []
        all_genres = []
        best_poster = first.get("poster") or "assets/posters/fallback.svg"
        best_source_poster = first.get("sourcePosterUrl") or first.get("posterUrl") or ""
        
        for v in variants:
            # Languages
            for l in (v.get("languages") or []):
                if l and l not in all_langs:
                    all_langs.append(l)
            # Qualities
            for q in (v.get("qualities") or []):
                q_label = q.get("label") if isinstance(q, dict) else str(q)
                if q_label and q_label not in all_quals:
                    all_quals.append(q_label)
            # Audio
            for a in (v.get("audioTracks") or []):
                if a and a not in all_audios:
                    all_audios.append(a)
            # Platform
            if v.get("platform") and v.get("platform") not in all_platforms:
                all_platforms.append(v.get("platform"))
            # Genres
            for g in (v.get("genres") or []):
                if g and g not in all_genres:
                    all_genres.append(g)
            # Poster prioritization: prefer real image over fallback
            v_poster = v.get("poster") or ""
            if "fallback.svg" in best_poster and v_poster and "fallback.svg" not in v_poster:
                best_poster = v_poster
                best_source_poster = v.get("sourcePosterUrl") or v.get("posterUrl") or best_source_poster
                
        # Build canonical entry conforming to Section 11 Data Model
        canon = {
            "id": f"praflix-{canonical_id}",
            "canonicalId": canonical_id,
            "displayTitle": first["displayTitle"],
            "originalSourceTitle": first.get("originalSourceTitle") or first.get("rawTitle", ""),
            "normalizedTitle": first["normalizedTitle"],
            "year": first["year"] if first["year"] else None,
            "type": first["type"],
            "season": first["season"] if first["season"] else None,
            "episodeStatus": first.get("episodeStatus"),
            "genres": all_genres if all_genres else ["Cinema"],
            "languages": all_langs if all_langs else ["Hindi"],
            "audioTracks": all_audios,
            "audio": " | ".join(all_audios) if all_audios else (first.get("audio") or "Standard"),
            "platform": all_platforms[0] if len(all_platforms) == 1 else (" | ".join(all_platforms) if all_platforms else None),
            "platforms": all_platforms,
            "releaseType": first.get("releaseType"),
            "poster": best_poster,
            "sourcePosterUrl": best_source_poster,
            "qualities": all_quals,
            "variantCount": len(variants),
            "variants": [
                {
                    "sourceId": v.get("id") or v.get("sourceId"),
                    "sourceUrl": v.get("sourceUrl"),
                    "originalSourceTitle": v.get("originalSourceTitle") or v.get("rawTitle"),
                    "languages": v.get("languages", []),
                    "qualities": v.get("qualities", []),
                    "releaseType": v.get("releaseType"),
                    "audio": v.get("audio"),
                    "platform": v.get("platform"),
                    "poster": v.get("poster")
                }
                for v in variants
            ],
            "status": "active"
        }
        canonical_titles.append(canon)
        canonical_id += 1
        
    return canonical_titles, ambiguous_records
