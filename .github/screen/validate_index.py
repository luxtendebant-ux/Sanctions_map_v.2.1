"""Check the actual browser index and delta schemas, source coverage and row counts."""

from collections import Counter
import json
from pathlib import Path


def validate(index, delta):
    columns = ["s", "i", "t", "n", "a", "b", "p", "l", "x", "c", "f"]
    if index.get("schema") != "cm2-screen/1" or index.get("cols") != columns:
        raise ValueError("Unsupported index schema or column layout")
    if delta.get("schema") != "cm2-screen-delta/1" or not isinstance(delta["items"], list):
        raise ValueError("Unsupported changes feed")
    sources = index["sources"]
    expected = {"OFAC", "OFACNS", "EU", "UK", "CA", "CH"}
    if len(sources) != len(expected) or {source["id"] for source in sources} != expected:
        raise ValueError("Incomplete list of sources")
    counts = Counter()
    for row in index["e"]:
        if len(row) != len(columns) or not row[1] or not row[3] or not isinstance(row[4], list) or not isinstance(row[8], list):
            raise ValueError("Incomplete index row")
        counts[row[0]] += 1
    if set(counts) != expected or sum(counts.values()) < 20000:
        raise ValueError("Incomplete screening index")
    for source in sources:
        if source["status"] not in ("ok", "stale") or source["count"] != counts[source["id"]]:
            raise ValueError(f"Missing or inconsistent data for {source['id']}")
        print(f"{source['id']}: {source['status']}, {source['count']} records, last fetched {source.get('fetched') or 'unknown'}")
    print(f"Total: {sum(counts.values())} records and {len(delta['items'])} changes")


if __name__ == "__main__":
    validate(*(json.loads(Path(name).read_text(encoding="utf-8")) for name in ("screen-index.json", "screen-delta.json")))
