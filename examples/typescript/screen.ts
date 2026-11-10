// Screen one name with the Screen Terminal API and print the bands and top matches.
//
//   export SCREEN_API_KEY=...        # free key: https://screen.unbackoffice.com/key
//   npx tsx screen.ts "Vladimir Putin" 1952-10-07 RU
//
// Uses the global fetch (Node 18+). No dependencies.

const BASE_URL = (process.env.SCREEN_API_URL || "https://screen.unbackoffice.com").replace(/\/+$/, "");

interface Match {
  name: string;
  match_score: number;
  match_band: string;
  risk_types?: string[];
  country?: string | null;
}

interface ScreenResult {
  result_band: string;
  sanctions_band?: string;
  pep_band?: string;
  watchlist_band?: string;
  match_count?: number;
  matches?: Match[];
  data_as_of?: string;
}

async function main(): Promise<number> {
  const [name, dob, country] = process.argv.slice(2);
  if (!name) {
    console.error('usage: screen.ts "Full Name" [dob] [country]');
    return 2;
  }
  const key = process.env.SCREEN_API_KEY;
  if (!key) {
    console.error("Set SCREEN_API_KEY. Get a free key at https://screen.unbackoffice.com/key");
    return 2;
  }

  const body: Record<string, string> = { name };
  if (dob) body.dob = dob;
  if (country) body.country = country;

  const res = await fetch(`${BASE_URL}/v1/screen`, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text();
    let detail: unknown = raw;
    try {
      detail = JSON.parse(raw).detail;
    } catch {
      /* not JSON */
    }
    console.error(`HTTP ${res.status}: ${JSON.stringify(detail)}`);
    return 1;
  }

  const r = (await res.json()) as ScreenResult;
  console.log(`result_band:    ${r.result_band}`);
  console.log(`sanctions_band: ${r.sanctions_band}`);
  console.log(`pep_band:       ${r.pep_band}`);
  console.log(`watchlist_band: ${r.watchlist_band}`);
  console.log(`matches:        ${r.match_count ?? 0}  (data as of ${r.data_as_of})`);
  for (const m of (r.matches ?? []).slice(0, 5)) {
    console.log(
      `  ${m.match_score.toFixed(2)}  ${m.match_band.padEnd(8)}  ${m.name}  [${(m.risk_types ?? []).join(", ")}]  ${m.country ?? ""}`,
    );
  }
  return 0;
}

main().then((code) => process.exit(code));
