import json
import time
import os
from .config import SYNC_STATE_JSON

class SyncEngine:
    def __init__(self, state_file=SYNC_STATE_JSON):
        self.state_file = state_file
        self.state = self.load_state()

    def load_state(self):
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "lastSyncTimestamp": None,
            "syncCount": 0,
            "trackedRecords": {}
        }

    def save_state(self):
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(self.state, f, indent=2)

    def process_sync(self, current_inventory):
        """
        Compare current discovered inventory against previous state.
        Determines: NEW, UPDATED, UNCHANGED, MISSING.
        Idempotent: Running twice with same inventory produces UNCHANGED and 0 new records.
        """
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        tracked = self.state.get("trackedRecords", {})
        
        new_records = []
        updated_records = []
        unchanged_records = []
        missing_records = []
        
        current_urls = set()
        
        for item in current_inventory:
            url = item.get("sourceUrl")
            if not url:
                continue
            current_urls.add(url)
            
            raw_title = item.get("rawTitle", "")
            poster = item.get("posterUrl", "")
            
            if url not in tracked:
                tracked[url] = {
                    "firstSeen": now,
                    "lastSeen": now,
                    "status": "active",
                    "missingSince": None,
                    "title": raw_title,
                    "poster": poster
                }
                new_records.append(item)
            else:
                prev = tracked[url]
                prev["lastSeen"] = now
                prev["status"] = "active"
                prev["missingSince"] = None
                
                changed = []
                if raw_title and raw_title != prev.get("title"):
                    changed.append("title")
                    prev["title"] = raw_title
                if poster and poster != prev.get("poster"):
                    changed.append("poster")
                    prev["poster"] = poster
                    
                if changed:
                    item["changedFields"] = changed
                    updated_records.append(item)
                else:
                    unchanged_records.append(item)
                    
        # Check for records that disappeared from current crawl
        for url, meta in tracked.items():
            if url not in current_urls:
                if not meta.get("missingSince"):
                    meta["missingSince"] = now
                    meta["status"] = "possibly_missing"
                else:
                    # Inactive after multiple syncs / grace period
                    meta["status"] = "inactive"
                missing_records.append({"sourceUrl": url, **meta})

        self.state["lastSyncTimestamp"] = now
        self.state["syncCount"] = self.state.get("syncCount", 0) + 1
        self.save_state()

        return {
            "syncTimestamp": now,
            "newCount": len(new_records),
            "updatedCount": len(updated_records),
            "unchangedCount": len(unchanged_records),
            "missingCount": len(missing_records),
            "newRecords": new_records,
            "updatedRecords": updated_records
        }
