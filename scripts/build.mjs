#!/usr/bin/env node
// Zostaví balíky rozšírenia pre Chrome, Edge a Firefox (bez závislostí, funguje na Windows aj Linuxe).
//   node scripts/build.mjs            všetky tri
//   node scripts/build.mjs firefox    len vybrané
// Výstup: dist/<prehliadač>/ (rozbalené, pre web-ext a ručné načítanie) a dist/spravy-bez-negativ-<prehliadač>.zip
//
// Zdrojový kód je jeden. Chrome a Edge (oba Chromium) používajú manifest tak, ako je.
// Firefox potrebuje: background.scripts namiesto service_worker, gecko id a údaje o zbieraní dát.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const TARGETS = ["chrome", "edge", "firefox"];
const GECKO_ID = "spravy-bez-negativ@mejmo.github.io";

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = requested.length ? requested : TARGETS;
for (const t of targets) if (!TARGETS.includes(t)) { console.error(`Neznámy cieľ "${t}". Povolené: ${TARGETS.join(", ")}`); process.exit(1); }

// zoznam súborov z jedného zdroja pravdy (kontrola zároveň overí manifest, syntax a tajomstvá)
const chk = spawnSync(process.execPath, [join(root, "scripts/check.mjs"), "--list"], { encoding: "utf8" });
if (chk.status !== 0) { console.error(chk.stderr || chk.stdout); process.exit(1); }
const files = chk.stdout.split("\n").filter(Boolean);
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

function manifestFor(target) {
  const m = structuredClone(manifest);
  if (target === "firefox") {
    // Firefox MV3: event page (background.scripts), nie service worker
    m.background = { scripts: [manifest.background.service_worker] };
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: "140.0", // od tejto verzie Firefox pozná data_collection_permissions
        // na AMO povinné: na vyhodnotenie sa posiela text správ z navštívenej stránky
        data_collection_permissions: { required: ["websiteContent"] }
      },
      gecko_android: { strict_min_version: "142.0" }
    };
  }
  return m;
}

// ---- minimálny ZIP zapisovač (deflate, UTF-8 názvy, pevný čas = reprodukovateľný výstup) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

mkdirSync(dist, { recursive: true });
for (const target of targets) {
  const dir = join(dist, target);
  rmSync(dir, { recursive: true, force: true });
  const entries = files.map((name) => ({
    name,
    data: name === "manifest.json"
      ? Buffer.from(JSON.stringify(manifestFor(target), null, 2) + "\n", "utf8")
      : readFileSync(join(root, name))
  }));
  for (const { name, data } of entries) {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
  const zipPath = join(dist, `spravy-bez-negativ-${target}.zip`);
  writeFileSync(zipPath, makeZip(entries));
  console.log(`${target.padEnd(8)} ${files.length} súborov -> ${zipPath.replace(root + "\\", "").replace(root + "/", "")}`);
}
