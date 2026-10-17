#!/usr/bin/env node
// Kontrola rozšírenia (bez závislostí):
//   node scripts/check.mjs          overí manifest, súbory, syntax a tajomstvá
//   node scripts/check.mjs --list   vypíše súbory, ktoré patria do balíka (jeden na riadok)
// V CI pri tagu `vX.Y.Z` navyše overí, že verzia v manifeste zodpovedá tagu.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (m) => errors.push(m);

// --- manifest ---
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
} catch (e) {
  console.error("manifest.json: neplatný JSON: " + e.message);
  process.exit(1);
}
if (manifest.manifest_version !== 3) fail("manifest_version musí byť 3");
for (const k of ["name", "version", "description"]) if (!manifest[k]) fail(`manifest: chýba "${k}"`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) fail(`manifest: verzia "${manifest.version}" nie je tvaru x.y.z`);

// --- súbory, ktoré manifest odkazuje (a ktoré odkazujú HTML stránky) ---
const files = new Set(["manifest.json"]);
const add = (p) => p && files.add(p.replace(/^\.?\//, ""));
add(manifest.background?.service_worker);
add(manifest.options_page);
add(manifest.action?.default_popup);
Object.values(manifest.icons || {}).forEach(add);
const di = manifest.action?.default_icon;
(typeof di === "string" ? [di] : Object.values(di || {})).forEach(add);
for (const cs of manifest.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach(add);
for (const f of [...files].filter((f) => f.endsWith(".html"))) {
  if (!existsSync(join(root, f))) continue;
  const html = readFileSync(join(root, f), "utf8");
  for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"'#?]+)["']/g)) {
    if (!/^(https?:)?\/\//.test(m[1])) add(m[1]);
  }
}
for (const f of files) if (!existsSync(join(root, f))) fail(`chýba súbor "${f}" odkazovaný z manifestu/HTML`);

if (process.argv.includes("--list")) {
  if (errors.length) { errors.forEach((e) => console.error("CHYBA: " + e)); process.exit(1); }
  console.log([...files].sort().join("\n"));
  process.exit(0);
}

// --- syntax všetkých .js v koreni ---
for (const f of readdirSync(root).filter((f) => f.endsWith(".js"))) {
  const r = spawnSync(process.execPath, ["--check", join(root, f)], { encoding: "utf8" });
  if (r.status !== 0) fail(`${f}: syntaktická chyba\n${r.stderr}`);
}

// --- bezpečnosť: žiadny API kľúč a žiadne priame volanie OpenAI v balíku ---
for (const f of files) {
  const p = join(root, f);
  if (!existsSync(p) || !/\.(js|html|json|css)$/.test(f)) continue;
  const text = readFileSync(p, "utf8");
  if (/sk-[A-Za-z0-9_-]{20,}/.test(text)) fail(`${f}: vyzerá, že obsahuje API kľúč (sk-…)`);
  if (/api\.openai\.com/.test(text)) fail(`${f}: obsahuje api.openai.com (rozšírenie nemá volať OpenAI priamo)`);
}
if ((manifest.host_permissions || []).some((h) => /openai\.com/.test(h))) fail("host_permissions obsahuje openai.com");

// --- veľkosť ikon: musia byť PNG ---
for (const f of files) {
  if (!f.endsWith(".png") || !existsSync(join(root, f))) continue;
  const b = readFileSync(join(root, f));
  if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") fail(`${f}: nie je platné PNG`);
}

// --- tag vs. verzia ---
const ref = process.env.GITHUB_REF_NAME || "";
if (/^v\d/.test(ref) && ref !== `v${manifest.version}`) {
  fail(`tag ${ref} nezodpovedá verzii v manifeste (v${manifest.version})`);
}

if (errors.length) {
  errors.forEach((e) => console.error("CHYBA: " + e));
  console.error(`\n${errors.length} chýb.`);
  process.exit(1);
}
const total = [...files].reduce((s, f) => s + (existsSync(join(root, f)) ? statSync(join(root, f)).size : 0), 0);
console.log(`OK: ${manifest.name} ${manifest.version}, ${files.size} súborov v balíku, ${(total / 1024).toFixed(1)} kB`);
