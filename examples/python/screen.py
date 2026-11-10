"""Screen one name with the Screen Terminal API and print the bands and top matches.

    pip install requests
    export SCREEN_API_KEY=...        # free key: https://screen.unbackoffice.com/key
    python screen.py "Vladimir Putin" --dob 1952-10-07 --country RU
"""
import argparse
import json
import os
import sys

import requests

BASE_URL = os.environ.get("SCREEN_API_URL", "https://screen.unbackoffice.com").rstrip("/")


def main() -> int:
    p = argparse.ArgumentParser(description="Screen one name.")
    p.add_argument("name")
    p.add_argument("--dob", help="date of birth, YYYY-MM-DD preferred")
    p.add_argument("--country", help="ISO-3166 alpha-2, e.g. RU")
    args = p.parse_args()

    key = os.environ.get("SCREEN_API_KEY")
    if not key:
        print("Set SCREEN_API_KEY. Get a free key at https://screen.unbackoffice.com/key", file=sys.stderr)
        return 2

    body = {"name": args.name}
    if args.dob:
        body["dob"] = args.dob
    if args.country:
        body["country"] = args.country

    r = requests.post(f"{BASE_URL}/v1/screen", json=body, headers={"X-API-Key": key}, timeout=60)
    if not r.ok:
        try:
            detail = r.json().get("detail")
        except ValueError:
            detail = r.text
        print(f"HTTP {r.status_code}: {json.dumps(detail)}", file=sys.stderr)
        return 1

    res = r.json()
    print(f"result_band:    {res['result_band']}")
    print(f"sanctions_band: {res.get('sanctions_band')}")
    print(f"pep_band:       {res.get('pep_band')}")
    print(f"watchlist_band: {res.get('watchlist_band')}")
    print(f"matches:        {res.get('match_count', 0)}  (data as of {res.get('data_as_of')})")
    for m in res.get("matches", [])[:5]:
        print(f"  {m.get('match_score', 0):.2f}  {m.get('match_band'):<8}  {m.get('name')}"
              f"  [{', '.join(m.get('risk_types') or [])}]  {m.get('country') or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
