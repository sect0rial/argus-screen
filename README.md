# argus-screen

Screen Terminal is an HTTP API that checks a name against PEP, sanctions, entity, enforcement and watchlist records.
This repo holds the API spec, short client examples and a small MCP server. The screening engine and the data are not in this repo.

- API docs: https://screen.unbackoffice.com/docs
- Coverage, meaning every country and list and when each last refreshed: https://screen.unbackoffice.com/coverage
- Tiers: https://screen.unbackoffice.com/tiers
- Free key: https://screen.unbackoffice.com/key (sign in with Google or an email link)

## Try it

```sh
export SCREEN_API_KEY=...   # your key

curl -s https://screen.unbackoffice.com/v1/screen \
  -H "X-API-Key: $SCREEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Vladimir Putin", "dob": "1952-10-07", "country": "RU"}'
```
No key yet? The home page at https://screen.unbackoffice.com has a shared demo key in a ready-to-run curl command (5 calls a day per IP).

## Endpoints

Base URL `https://screen.unbackoffice.com`. Send the key in the `X-API-Key` header.

| Method | Path | Body |
|---|---|---|
| POST | `/v1/screen` | `name` (required, 2 to 200 chars, any script), `dob`, `country` (ISO-3166 alpha-2), `aliases` (up to 8), `city` |
| POST | `/v1/screen/batch` | `{"queries": [ ...up to 50 of the above... ]}` |

`dob` is best as `YYYY-MM-DD`. `DD/MM/YYYY`, `7 Oct 1952`, `YYYY-MM` and `YYYY` are also read. An unreadable date is ignored, never counted as a mismatch.
Companies and vessels go in `name` too.

The full spec is in [`openapi.json`](openapi.json).

## Response

Trimmed. Real responses carry more per match: positions, other names, sources, an explanation and the evidence.

```json
{
  "result_band": "strong",
  "match_count": 1,
  "sanctions_band": "strong",
  "pep_band": "strong",
  "watchlist_band": "none",
  "by_type": {
    "sanction": {"band": "strong", "match_count": 1, "top_score": 1.0, "top_name": "Vladimir Vladimirovich Putin"},
    "pep":      {"band": "strong", "match_count": 1, "top_score": 1.0, "top_name": "Vladimir Vladimirovich Putin"},
    "watchlist": {"band": "none", "match_count": 0, "top_score": null, "top_name": null}
  },
  "matches": [
    {
      "person_id": "…",
      "name": "Vladimir Vladimirovich Putin",
      "country": "RU",
      "date_of_birth": "1952-10-07",
      "match_score": 1.0,
      "match_band": "strong",
      "risk_types": ["sanction", "pep"],
      "pep_classification": "sanctioned",
      "matched_on": ["name", "country", "dob"],
      "signals": {"matched_name_form": "canonical"},
      "weak_aliases": [],
      "generated_aliases": []
    }
  ],
  "dob_check": {"input": "1952-10-07", "status": "ok", "read_as": "1952-10-07", "note": null},
  "screened_at": "2026-11-10T09:30:00Z",
  "data_as_of": "2026-11-10T01:00:00Z"
}
```

- Bands, highest first: `strong` (treat as a hit), `possible` (send to an analyst), `weak` (low similarity or a conflicting detail such as date of birth), `none`.
- `result_band` is the highest band of any match. Route on `sanctions_band`, `pep_band` and `watchlist_band`, because a sanctions hit can rank below a stronger PEP namesake.
- `by_type` gives the band, count and top match for each type: sanction, pep, rca, watchlist, debarment, regulatory, adverse_media, soe, other.
- `matches` is best first. `match_score` runs from 0 to 1.
- Sanctions hits are shown at every band so you can review them under your own policy.
- `screened_at` is when the screen ran. `data_as_of` is how fresh the lists were.

A batch returns `count`, `with_matches`, `with_sanctions_matches`, `with_pep_matches` and `results`, one result per name in order.

A match is a lead to review. It is not a finding about the person.

## Limits

- A free key has 100 screens with a work email, 25 with a personal one. They don't expire or reset. One name is one screen, so a batch of 20 uses 20.
- A batch is all or nothing. If the key can't cover every name, nothing is screened or charged.
- Invalid requests (`422`) are not charged.
- Rate limits: 30 requests a minute per key and 60 a minute per IP. Over that you get `429`.
- More screens: https://screen.unbackoffice.com/tiers

| Status | Meaning |
|---|---|
| 401 | Missing, invalid or revoked key |
| 402 | No screens left on the key |
| 403 | The key can't call that endpoint |
| 422 | Invalid request, e.g. a one-letter name or more than 50 names in a batch |
| 429 | Too many requests. Wait and retry |
| 503 | Temporarily unavailable. Retry shortly |

Errors are JSON with a `detail` field, e.g. `{"detail": "invalid X-API-Key"}`.

## Examples

Both read `SCREEN_API_KEY`, screen one name and print the bands and the top matches.

```sh
# Python 3.9+, needs requests
pip install requests
python examples/python/screen.py "Vladimir Putin" --dob 1952-10-07 --country RU

# TypeScript, Node 18+, no dependencies
npx tsx examples/typescript/screen.ts "Vladimir Putin" 1952-10-07 RU
```

## MCP server

A stdio MCP server that wraps the API, so an MCP client can screen names. It runs straight from GitHub with `npx`.
Each name it screens uses one screen from your key.

Tools:

- `screen_name`: `name`, optional `dob`, `country`, `kind` (`person`, `company` or `vessel`) and `full`. Returns the bands and the top matches, or the whole response with `full: true`.
- `screen_batch`: `queries`, 1 to 50 items with the same fields as `screen_name`.

`kind` is not an API field. It only changes what is sent, as on the website: for a company or vessel the date of birth is left out, and for a vessel the country too.

**Claude Code**

```sh
claude mcp add argus-screen -e SCREEN_API_KEY=your-key -- npx -y github:sect0rial/argus-screen
```

**Claude Desktop** (`claude_desktop_config.json`) and **Cursor** (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project) take the same block:

```json
{
  "mcpServers": {
    "argus-screen": {
      "command": "npx",
      "args": ["-y", "github:sect0rial/argus-screen"],
      "env": { "SCREEN_API_KEY": "your-key" }
    }
  }
}
```

Restart the client after editing the file.

From a clone:

```sh
npm install
npm run build          # compiles mcp/src to mcp/dist (mcp/dist is committed, so npx needs no build step)
npm run verify         # starts the server, runs initialize and tools/list, calls screen_name once
```

`SCREEN_API_URL` overrides the base URL. It defaults to `https://screen.unbackoffice.com`.

## openapi.json

Saved from the live service and pretty-printed:

```sh
curl -s https://screen.unbackoffice.com/openapi.json | python3 -m json.tool --indent 2 --no-ensure-ascii > openapi.json
```

Fetched on 10 November 2026. The live document is the reference if the two differ.

## What is not here

The screening engine, the matching rules and the list data run on Screen Terminal's servers. They are not in this repo and not under its licence.

## Licence

The code in this repo is MIT licensed. See [LICENSE](LICENSE).
