// Make the built server executable so `npx` can run it as a bin.
import { chmodSync } from "node:fs";
chmodSync(new URL("../mcp/dist/index.js", import.meta.url), 0o755);
