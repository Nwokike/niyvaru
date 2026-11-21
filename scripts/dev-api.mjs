/**
 * Local development API server for environments where `wrangler dev` cannot
 * run (e.g. Alpine/musl, where workerd's glibc binary will not start).
 * It imports the exact same worker handler — no duplicated logic — and reads
 * GATEWAY_SECRET from worker/.dev.vars or the process environment.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import worker from "../worker/src/index.ts";

const env = { GATEWAY_URL: process.env.GATEWAY_URL || "https://api.kiri.ng" };
try {
  const txt = await readFile(new URL("../worker/.dev.vars", import.meta.url), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch {
  /* .dev.vars is optional */
}
if (process.env.GATEWAY_SECRET) env.GATEWAY_SECRET = process.env.GATEWAY_SECRET;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, {
    method: req.method || "GET",
    headers: req.headers,
    body,
  });
  try {
    const response = await worker.fetch(request, env, {});
    res.statusCode = response.status;
    for (const [k, v] of response.headers) res.setHeader(k, v);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(8787, "127.0.0.1", () => {
  console.log(`niyvaru dev api on http://127.0.0.1:8787 (gateway secret ${env.GATEWAY_SECRET ? "loaded" : "MISSING"})`);
});
