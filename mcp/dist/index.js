#!/usr/bin/env node
// Stdio MCP server for the Screen Terminal name screening API (https://screen.unbackoffice.com).
// Reads the API key from SCREEN_API_KEY. The screening engine and data are not in this repo: every tool
// call is an HTTPS request to the API, and each name screened uses one screen from the key's quota.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const VERSION = "0.1.0";
const BASE_URL = (process.env.SCREEN_API_URL || "https://screen.unbackoffice.com").replace(/\/+$/, "");
const MAX_BATCH = 50; // BatchScreenQuery.queries maxItems in openapi.json
const TOP_MATCHES = 5;
const text = (body, isError = false) => ({
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body, null, 2) }],
    ...(isError ? { isError: true } : {}),
});
const NO_KEY = "SCREEN_API_KEY is not set. Get a free key at https://screen.unbackoffice.com/key " +
    "and add it to this server's environment.";
async function call(path, body) {
    const key = process.env.SCREEN_API_KEY;
    if (!key)
        return { ok: false, result: text(NO_KEY, true) };
    let res;
    try {
        res = await fetch(BASE_URL + path, {
            method: "POST",
            headers: {
                "X-API-Key": key,
                "Content-Type": "application/json",
                "User-Agent": `argus-screen-mcp/${VERSION}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });
    }
    catch (e) {
        return { ok: false, result: text(`Request to ${BASE_URL}${path} failed: ${e.message}`, true) };
    }
    const raw = await res.text();
    let parsed = raw;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        /* not JSON: keep the text */
    }
    if (!res.ok) {
        const detail = typeof parsed === "object" && parsed !== null && "detail" in parsed ? parsed.detail : parsed;
        const hint = {
            401: "The key is missing, invalid or revoked. Check SCREEN_API_KEY.",
            402: "The key has no screens left. See https://screen.unbackoffice.com/tiers",
            404: "This endpoint is not available on this host.",
            422: "The request was rejected as invalid.",
            429: "Rate limited. Wait a minute and retry.",
        };
        return { ok: false, result: text({ status: res.status, detail, hint: hint[res.status] }, true) };
    }
    return { ok: true, data: parsed };
}
// `kind` is not an API field. As the Screen Terminal website does, it only changes what is sent:
// a date of birth means something for a person only, and a vessel is screened without a country (flags change).
const KIND = z.enum(["person", "company", "vessel"]);
function queryBody(q) {
    const out = { name: q.name };
    const kind = q.kind ?? "person";
    if (q.dob && kind === "person")
        out.dob = q.dob;
    if (q.country && kind !== "vessel")
        out.country = q.country;
    return out;
}
const MATCH_FIELDS = [
    "name",
    "match_score",
    "match_band",
    "risk_types",
    "pep_classification",
    "country",
    "date_of_birth",
    "matched_on",
    "person_id",
];
function trimMatch(m) {
    const src = (m ?? {});
    const out = {};
    for (const k of MATCH_FIELDS)
        if (src[k] !== undefined)
            out[k] = src[k];
    return out;
}
function summarise(r, top = TOP_MATCHES) {
    const matches = Array.isArray(r.matches) ? r.matches : [];
    const out = {};
    for (const k of ["query", "result_band", "sanctions_band", "pep_band", "watchlist_band", "match_count"]) {
        if (r[k] !== undefined)
            out[k] = r[k];
    }
    out.top_matches = matches.slice(0, top).map(trimMatch);
    if (matches.length > top)
        out.more_matches = matches.length - top;
    for (const k of ["dob_check", "screened_at", "data_as_of"])
        if (r[k] !== undefined)
            out[k] = r[k];
    return out;
}
const name = z.string().min(2).max(200).describe("Name of a person, company or vessel, in any script");
const dob = z
    .string()
    .max(32)
    .optional()
    .describe("Date of birth, YYYY-MM-DD preferred (YYYY-MM and YYYY also accepted). People only.");
const country = z.string().max(56).optional().describe("ISO-3166 alpha-2 country code, e.g. RU");
const kind = KIND.optional().describe("What the name is: person (default), company or vessel. Not sent to the API: for a company or vessel the date " +
    "of birth is dropped, and for a vessel the country too.");
const server = new McpServer({ name: "argus-screen", version: VERSION });
server.registerTool("screen_name", {
    title: "Screen a name",
    description: "Screen one name against PEP, sanctions, entity, enforcement and watchlist records via Screen Terminal " +
        "(POST /v1/screen). Returns result_band (strong, possible, weak or none), the per-type bands " +
        "(sanctions_band, pep_band, watchlist_band) and the top matches. Route on the per-type bands, not " +
        "result_band alone. Uses one screen from the key's quota. A match is a lead for review, not a finding.",
    inputSchema: {
        name,
        dob,
        country,
        kind,
        full: z.boolean().optional().describe("Return the whole API response instead of a summary"),
    },
}, async (args) => {
    const r = await call("/v1/screen", queryBody(args));
    if (!r.ok)
        return r.result;
    return text(args.full ? r.data : summarise(r.data));
});
server.registerTool("screen_batch", {
    title: "Screen up to 50 names",
    description: `Screen up to ${MAX_BATCH} names in one call (POST /v1/screen/batch). Each name uses one screen; a batch is ` +
        "all or nothing, so if the key cannot cover every name nothing is screened. Returns counts and, per name in " +
        "order, the bands and top matches.",
    inputSchema: {
        queries: z
            .array(z.object({ name, dob, country, kind }))
            .min(1)
            .max(MAX_BATCH)
            .describe(`1 to ${MAX_BATCH} names`),
    },
}, async ({ queries }) => {
    const r = await call("/v1/screen/batch", { queries: queries.map(queryBody) });
    if (!r.ok)
        return r.result;
    const d = r.data;
    const results = Array.isArray(d.results) ? d.results : [];
    const out = {};
    for (const k of ["count", "with_matches", "with_sanctions_matches", "with_pep_matches"]) {
        if (d[k] !== undefined)
            out[k] = d[k];
    }
    out.results = results.map((x) => summarise(x, 3));
    return text(out);
});
await server.connect(new StdioServerTransport());
