import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Lightweight pre-ship gate: no test harness is installed yet, so this checks
 * the build artifacts that have historically broken static deployment.
 */
const root = process.cwd();
const required = [
  "dist/index.html",
  "dist/assets/maplibre-gl-worker.mjs",
  "dist/brand/favicon.ico",
  "dist/areas.json",
  "dist/sw.js",
];

const missing = required.filter((p) => !existsSync(resolve(root, p)));
if (missing.length) {
  console.error("Missing build artifacts:", missing.join(", "));
  process.exit(1);
}

const html = readFileSync(resolve(root, "dist/index.html"), "utf8");
const base = process.env.VITE_BASE;
if (base && !html.includes(`src="${base.replace(/\/$/, "")}/assets/`)) {
  console.error(`Build does not use VITE_BASE=${base} for assets.`);
  process.exit(1);
}
if (!base && html.includes('src="/niyvaru/assets/')) {
  console.error("Root build unexpectedly uses the /niyvaru/ asset prefix.");
  process.exit(1);
}

const legacy = ["src/agent.ts", "data/build-data.mjs", "public/packs/index.json", "NASA EONET"];
const assets = readdirSync(resolve(root, "dist/assets"));
const js = assets.filter((f) => f.endsWith(".js")).map((f) => readFileSync(resolve(root, "dist/assets", f), "utf8")).join("\n");
const foundLegacy = legacy.filter((s) => js.includes(s));
if (foundLegacy.length) {
  console.error("Legacy strings in built JS:", foundLegacy.join(", "));
  process.exit(1);
}

console.log("Build artifacts verified.");
