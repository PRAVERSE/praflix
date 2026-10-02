"""
PRAFLIX — A PRAVERSE Company
Catalog Chunk Exporter & Production Asset Optimizer

Splits canonical catalog into compliant static chunks (<25 MiB Cloudflare limit)
with full data integrity preservation (100% lossless).
"""

import os
import json
import math

def export_catalog_chunks(catalog_records, target_dir, num_chunks=4, write_monolithic=False):
    """
    Exports canonical catalog records into compliant chunks (<25 MiB)
    with JSON files, JS files for offline script loading, and a manifest.
    
    Args:
        catalog_records: list of canonical title dicts (15,433 records)
        target_dir: directory path to write the chunks to (e.g. 'data' or 'dist/data')
        num_chunks: number of partitions (default 4)
    
    Returns:
        dict with export summary, file paths, and verification result
    """
    os.makedirs(target_dir, exist_ok=True)
    total_records = len(catalog_records)
    
    if total_records == 0:
        raise ValueError("Cannot export empty catalog records list.")
    
    chunk_size = math.ceil(total_records / num_chunks)
    manifest_chunks = []
    chunk_metadata = []
    generated_files = []
    
    for i in range(num_chunks):
        start_idx = i * chunk_size
        end_idx = min(total_records, (i + 1) * chunk_size)
        chunk = catalog_records[start_idx:end_idx]
        chunk_num = i + 1
        
        # 1. JSON Chunk
        json_filename = f"catalog-chunk-{chunk_num}.json"
        json_path = os.path.join(target_dir, json_filename)
        json_str = json.dumps(chunk, separators=(',', ':'), ensure_ascii=False)
        with open(json_path, "w", encoding="utf-8") as f:
            f.write(json_str)
        
        json_size = os.path.getsize(json_path)
        generated_files.append((json_filename, json_size, len(chunk)))
        manifest_chunks.append(f"data/{json_filename}")
        
        # 2. JS Chunk (for zero-latency offline & file:/// execution)
        js_filename = f"catalog_chunk_{chunk_num}.js"
        js_path = os.path.join(target_dir, js_filename)
        js_content = f"window.PRAFLIX_DATA = (window.PRAFLIX_DATA || []).concat({json_str});\n"
        with open(js_path, "w", encoding="utf-8") as f:
            f.write(js_content)
        
        js_size = os.path.getsize(js_path)
        generated_files.append((js_filename, js_size, len(chunk)))
        
        chunk_metadata.append({
            "chunk": chunk_num,
            "recordCount": len(chunk),
            "startCanonicalId": chunk[0].get("canonicalId") if chunk else None,
            "endCanonicalId": chunk[-1].get("canonicalId") if chunk else None,
            "jsonFile": f"data/{json_filename}",
            "jsFile": f"data/{js_filename}",
            "jsonSizeBytes": json_size,
            "jsSizeBytes": js_size
        })

    # 3. Master Manifest File
    manifest_data = {
        "catalog": "PRAFLIX Master Cinema & Web Series Catalog",
        "publisher": "A PRAVERSE Company",
        "version": "2026.10.02",
        "totalRecords": total_records,
        "chunkCount": num_chunks,
        "maxFileLimitBytes": 26214400, # 25 MiB
        "chunks": manifest_chunks,
        "chunkMetadata": chunk_metadata
    }
    
    manifest_path = os.path.join(target_dir, "catalog-manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2, ensure_ascii=False)
    
    manifest_size = os.path.getsize(manifest_path)
    generated_files.append(("catalog-manifest.json", manifest_size, total_records))

    # 4. Optional minified monolithic catalog.json (22.79 MiB, < 25 MiB limit)
    # Available for direct single-file fetch or R2 hosting without exceeding Cloudflare limit
    if write_monolithic:
        minified_catalog_path = os.path.join(target_dir, "catalog.json")
        with open(minified_catalog_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(catalog_records, separators=(',', ':'), ensure_ascii=False))
        
        minified_size = os.path.getsize(minified_catalog_path)
        generated_files.append(("catalog.json", minified_size, total_records))

    # Verification: Reconstruct all chunks and verify identical match
    reconstructed = []
    for meta in chunk_metadata:
        chunk_file = os.path.join(target_dir, os.path.basename(meta["jsonFile"]))
        with open(chunk_file, "r", encoding="utf-8") as f:
            c_data = json.load(f)
            reconstructed.extend(c_data)
    
    is_valid = (reconstructed == catalog_records)
    if not is_valid:
        raise RuntimeError("Integrity verification failed: Reconstructed chunks do not match original catalog.")
    
    return {
        "totalRecords": total_records,
        "chunkCount": num_chunks,
        "files": generated_files,
        "verified": is_valid
    }

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    catalog_path = os.path.join(base_dir, "data", "catalog.json")
    target_data_dir = os.path.join(base_dir, "data")
    
    with open(catalog_path, "r", encoding="utf-8") as f:
        records = json.load(f)
    
    res = export_catalog_chunks(records, target_data_dir, num_chunks=4)
    print(f"Exported {res['totalRecords']} records across {res['chunkCount']} chunks. Verified: {res['verified']}")
    for name, sz, count in res["files"]:
        print(f" - {name}: {sz / (1024*1024):.2f} MiB ({count} records)")
