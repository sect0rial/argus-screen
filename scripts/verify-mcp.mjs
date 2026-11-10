// Start the built MCP server over stdio, run initialize + tools/list, and call screen_name once.
// With SCREEN_API_KEY unset the call fails locally without touching the network; with a key set it calls the API.
//   node scripts/verify-mcp.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../mcp/dist/index.js", import.meta.url));
const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"], env: process.env });

const pending = new Map();
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
const send = (method, params) => {
  const id = nextId++;
  const line = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  console.log(">>", line);
  child.stdin.write(line + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
  });
};
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

try {
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "verify-mcp", version: "0" },
  });
  console.log("<< initialize:", JSON.stringify(init.result.serverInfo), "protocol", init.result.protocolVersion);
  notify("notifications/initialized", {});

  const list = await send("tools/list", {});
  for (const t of list.result.tools) {
    console.log(`<< tool ${t.name}: inputs ${Object.keys(t.inputSchema.properties).join(", ")}`);
  }

  const call = await send("tools/call", { name: "screen_name", arguments: { name: "Jane Example" } });
  console.log("<< screen_name isError:", call.result.isError === true, "text:", call.result.content[0].text);
  child.kill();
  process.exit(0);
} catch (e) {
  console.error(e.message);
  child.kill();
  process.exit(1);
}
