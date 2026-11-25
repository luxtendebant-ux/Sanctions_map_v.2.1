"""Export the public JSON declarations consumed by the public map, without executing JavaScript."""

import argparse
import datetime as dt
import json
from pathlib import Path
import re


PUBLIC_FIELDS = {
    "meta": "MAP_META",
    "sections": "SECTIONS",
    "exportControl": "EXPORT_CONTROL",
    "russianMeasures": "RUSSIAN_MEASURES",
    "enforcement": "ENFORCEMENT",
    "fatcaCards": "FATCA_CARDS",
    "rumors": "RUMORS",
    "comparison": "COMPARISON",
    "deadlines": "DEADLINES",
    "changelog": "CHANGELOG",
    "execSummary": "EXEC_SUMMARY",
    "sourceRegistry": "SOURCE_REGISTRY",
    "officerConclusion": "OFFICER_CONCLUSION",
}


def read_public_fields(html):
    decoder = json.JSONDecoder()
    result = {"schema": "compliance-map-open/1"}
    for field, name in PUBLIC_FIELDS.items():
        matches = list(re.finditer(rf"^(?:let|const|var)\s+{name}\s*=\s*", html, re.M))
        if len(matches) != 1:
            raise ValueError(f"Expected one public JSON declaration for {name}")
        value, end = decoder.raw_decode(html, matches[0].end())
        if not html[end:].lstrip().startswith(";"):
            raise ValueError(f"{name} must contain a complete JSON literal")
        result[field] = value
    dt.datetime.strptime(result["meta"]["cut"], "%d.%m.%Y")
    for group in ("sections", "exportControl", "russianMeasures", "enforcement", "fatcaCards"):
        if not result[group] or not all(isinstance(s.get("items"), list) for s in result[group]):
            raise ValueError(f"Missing public cards in {group}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = read_public_fields(args.html.read_text(encoding="utf-8-sig"))
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    generated = previous.pop("generated", None)
    if previous == result and generated:
        return
    generated = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    document = {"schema": result.pop("schema"), "generated": generated, **result}
    payload = json.dumps(document, ensure_ascii=False, indent=1) + "\n"
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(payload, encoding="utf-8", newline="\n")
    temporary.replace(args.output)


if __name__ == "__main__":
    main()
