// Klient AI proxy. Rozšírenie nevolá OpenAI a nemá žiadny API kľúč.
// Chrome/Edge: `chrome`, Firefox: `browser` (s promisami)
const api = globalThis.browser ?? globalThis.chrome;
const PROXY_URL = "https://nonegative.replit.app/v1/classify";
const MAX_ITEMS = 25;
const MAX_TITLE = 400;
const MAX_BODY_BYTES = 40 * 1024;
// ID: 1-128 znakov, prvý znak písmeno/číslo (napr. "5630008", "m123456", "cas.sk:slug-clanku")
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(["positive", "neutral", "negative"]);
const TOPICS = new Set(["slovak_politics", "foreign_politics", "sports", "other"]);

// ---- identifikácia inštalácie (jedno ID, súbežné prvé volania zdieľajú ten istý promise) ----
let installIdPromise = null;
function getInstallId() {
  if (!installIdPromise) {
    installIdPromise = (async () => {
      const { installId } = await api.storage.local.get("installId");
      if (typeof installId === "string" && UUID4_RE.test(installId)) return installId;
      const id = crypto.randomUUID();
      await api.storage.local.set({ installId: id });
      return id;
    })().catch((e) => {
      installIdPromise = null;
      throw e;
    });
  }
  return installIdPromise;
}

// ---- najviac MAX_CONCURRENT súbežných požiadaviek na proxy (aj naprieč kartami) ----
const MAX_CONCURRENT = 4;
let active = 0;
const waiting = [];
function serialize(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active--;
        waiting.shift()?.();
      });
    };
    active < MAX_CONCURRENT ? start() : waiting.push(start);
  });
}

const normTitle = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
// Zdroj = doména bez protokolu, portu a cesty, malé písmená, bez úvodného "www.", najviac 253 znakov.
// Neplatný alebo chýbajúci zdroj vrátime ako null a pole sa nepošle (server použije predvolený web).
function normSource(s) {
  if (typeof s !== "string") return null;
  const d = s.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");
  return d.length <= 253 && DOMAIN_RE.test(d) ? d : null;
}
const bodyBytes = (items) => new TextEncoder().encode(JSON.stringify({ items })).length;

async function readError(res) {
  try {
    const j = await res.json();
    return typeof j?.error === "string" ? j.error : "";
  } catch {
    return "";
  }
}

// Posledný stav komunikácie s proxy (pre diagnostiku v štatistikách): odkiaľ presne prišla chyba.
async function recordStatus(s) {
  try { await api.storage.local.set({ lastProxyStatus: { ts: Date.now(), ...s } }); } catch {}
}

// Jedna HTTP požiadavka, jeden pokus. Žiadne pauzy ani opakovania: keď to nejde, správy sa jednoducho
// zobrazia nevyhodnotené a používateľ nie je nijako blokovaný.
async function postBatch(items) {
  const installId = await getInstallId();
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Install-Id": installId,
        "X-Ext-Version": api.runtime.getManifest().version
      },
      body: JSON.stringify({ items })
    });
  } catch {
    await recordStatus({ status: 0, error: "network" });
    return { ok: false, error: "network" };
  }

  const code = res.ok ? "" : await readError(res.clone ? res.clone() : res);
  await recordStatus({ status: res.status, error: code });

  if (res.ok) {
    try { return { ok: true, data: await res.json() }; } catch { return { ok: false, error: "bad_response" }; }
  }
  if (res.status === 429) return { ok: false, error: "rate_limited", status: 429 };
  if (res.status === 503 && code === "budget_exhausted") return { ok: false, error: "budget_exhausted", status: 503 };
  if (res.status === 400) return { ok: false, error: "bad_request", status: 400 };
  if ([401, 403, 404, 405].includes(res.status)) return { ok: false, error: "config", status: res.status };
  return { ok: false, error: "network", status: res.status };
}

// Platné výsledky len pre požadované id; všetko ostatné zahodíme.
function validate(data, wanted) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    const id = typeof r?.id === "string" ? r.id : String(r?.id);
    if (!wanted.has(id) || seen.has(id)) continue;
    if (!CATEGORIES.has(r.category)) continue;
    if (!Number.isInteger(r.damage) || r.damage < 0 || r.damage > 10) continue;
    seen.add(id);
    // topic zatiaľ len prenášame; neplatný alebo chýbajúci nie je dôvod výsledok zahodiť
    out.push({ id, category: r.category, damage: r.damage, topic: TOPICS.has(r.topic) ? r.topic : null });
  }
  return out;
}

// Rozdelí vstup na dávky po najviac 25 položiek a najviac 40 KiB tela.
function makeBatches(items) {
  const batches = [];
  let cur = [];
  for (const it of items) {
    const next = [...cur, it];
    if (cur.length && (next.length > MAX_ITEMS || bodyBytes(next) > MAX_BODY_BYTES)) {
      batches.push(cur);
      cur = [it];
    } else {
      cur = next;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function classify(rawItems) {
  // sanitizácia: platné ID, jedinečné ID, normalizovaný titulok a zdroj, nič iné
  const items = [];
  const ids = new Set();
  for (const r of Array.isArray(rawItems) ? rawItems : []) {
    const id = typeof r?.id === "string" ? r.id : "";
    const title = normTitle(r?.title);
    if (!ID_RE.test(id) || !title || ids.has(id)) continue;
    ids.add(id);
    const source = normSource(r?.source);
    items.push(source ? { id, title, source } : { id, title });
  }
  if (!items.length) return { ok: true, results: [] };

  const results = [];
  for (const batch of makeBatches(items)) {
    const r = await postBatch(batch);
    if (!r.ok) return { ...r, results }; // čiastočné výsledky sa vrátia, zvyšok ostane nevyhodnotený
    results.push(...validate(r.data, new Set(batch.map((b) => b.id))));
  }
  return results.length ? { ok: true, results } : { ok: false, error: "bad_response", results };
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "classify") return;
  serialize(() => classify(msg.items))
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: "network", results: [] }));
  return true; // async odpoveď
});

// Zvyšok po starých verziách: lokálne uložený OpenAI kľúč už nikdy nepotrebujeme.
const dropOldKey = () => api.storage.local.remove(["apiKey", "proxyPausedUntil"]);
api.runtime.onInstalled.addListener(dropOldKey);
api.runtime.onStartup.addListener(dropOldKey);
