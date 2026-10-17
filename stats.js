// Chrome/Edge: `chrome`, Firefox: `browser` (s promisami)
const api = globalThis.browser ?? globalThis.chrome;
// Štatistiky „mentálneho damage“ z logu, ktorý plní content.js (api.storage.local.dnnLog).
const HP_K = 0.25;          // koľko HP ubudne za 1 bod damage za deň (odhad z prsta)
const MIN_PER = { article: 5, minute: 1 }; // minúty trápenia ušetrené jednou správou

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => Math.round(n).toLocaleString("sk-SK");
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

// Zdravotné štádiá: od zenového mnícha po klinicky smutného.
const LEVELS = [
  { min: 90, face: "🧘", title: "Zen mních", note: "Dýchaš. Usmievaš sa. Podozrivé." },
  { min: 75, face: "🙂", title: "Fungujúci človek", note: "Občas ťa niečo otrávi, ale prežiješ." },
  { min: 55, face: "😬", title: "Zovreté čeľuste", note: "Ráno si ešte veril v ľudstvo." },
  { min: 35, face: "😵‍💫", title: "Doomscroll pacient", note: "Palec už scrolluje bez teba." },
  { min: 15, face: "🫠", title: "Klinicky skleslý", note: "Dobrú noc, optimizmus." },
  { min: 0,  face: "☠️", title: "Mentálne po exspirácii", note: "Čas na pauzu od správ." }
];
const level = (hp) => LEVELS.find((l) => hp >= l.min);

function hearts(hp) {
  const full = Math.round(hp / 20);
  return "❤️".repeat(full) + "🖤".repeat(5 - full);
}
const hpColor = (hp) => (hp >= 70 ? "var(--good)" : hp >= 40 ? "var(--mid)" : "var(--bad)");

function patient(kind, hp) {
  const l = level(hp);
  const p = el("div", `pat ${kind}`);
  p.append(el("div", "lbl", kind === "with" ? "S rozšírením" : "Bez rozšírenia"));
  const face = el("div", "face", l.face);
  if (hp < 35) face.classList.add("pulse");
  p.append(face, el("div", "title", l.title));
  p.append(el("div", "hearts", hearts(hp)));
  const bar = el("div", "bar"); const i = el("i"); i.style.width = hp + "%"; i.style.background = hpColor(hp);
  bar.append(i); p.append(bar, el("div", "hp", `${hp} / 100 HP`));
  p.append(el("div", "hp", l.note));
  return p;
}

function verdict(spared, hiddenCount, hpGain) {
  if (!hiddenCount) return "Zatiaľ sme ti nemali čo ušetriť. Svet má asi dobrý deň. Alebo si ho ešte neotvoril.";
  if (hpGain >= 60) return `Bez nás by si bol vrak. Ušetrili sme ti ${fmt(spared)} bodov damage. Neďakuj, je to naša práca.`;
  if (hpGain >= 30) return `Zachránili sme ťa pred ${fmt(hiddenCount)} správami. Tvoj terapeut nám ešte dlhuje províziu.`;
  if (hpGain >= 10) return `${fmt(hiddenCount)} negatívnych správ skončilo v koši. Ty si ich nikdy nečítal. Vďaka za spoluprácu.`;
  return `Dnes to bolo skoro znesiteľné: ${fmt(hiddenCount)} skrytých správ. Svet sa asi uráža.`;
}

function render(log, allowNeutral, since, range) {
  const app = $("#app");
  app.replaceChildren();
  const now = Date.now();
  const from = range === 0 ? 0 : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (range - 1)); return d.getTime(); })();
  const all = Object.entries(log).map(([id, e]) => ({ id, ...e })).filter((e) => e.ts >= from);
  $("#since").textContent = since
    ? `Na hliadke od ${new Date(since).toLocaleDateString("sk-SK")} · vyhodnotených správ: ${fmt(Object.keys(log).length)}`
    : "Ešte nič nevyhodnotené";

  if (!all.length) {
    const c = el("div", "card empty");
    c.append(el("div", "", "🩺"), el("div", "", "Prázdna čakáreň. Otvor svoj spravodajský web a nechaj nás pracovať."));
    app.append(c);
    return;
  }

  const hidden = (e) => e.c === "negative" || (e.c === "neutral" && !allowNeutral);
  const hiddenList = all.filter(hidden);
  const potential = all.reduce((s, e) => s + e.d, 0);
  const shown = all.filter((e) => !hidden(e)).reduce((s, e) => s + e.d, 0);
  const spared = potential - shown;
  const days = Math.max(1, new Set(all.map((e) => dayKey(e.ts))).size);
  const hpWithout = Math.round(clamp(100 - (potential / days) * HP_K, 2, 100));
  const hpWith = Math.round(clamp(100 - (shown / days) * HP_K, 2, 100));
  const minutes = hiddenList.reduce((s, e) => s + (MIN_PER[e.s] || 3), 0);

  // 1) pacienti
  const c1 = el("div", "card");
  c1.append(el("div", "verdict", verdict(spared, hiddenList.length, hpWith - hpWithout)));
  const pats = el("div", "patients");
  pats.append(patient("without", hpWithout), patient("with", hpWith));
  c1.append(pats);
  app.append(c1);

  // 2) čísla
  const c2 = el("div", "card");
  c2.append(el("h2", "", "Škody, ktoré nenastali"));
  const tiles = el("div", "tiles");
  const t = (num, label) => { const d = el("div", "tile"); d.append(el("b", "", num), el("span", "", label)); tiles.append(d); };
  t(fmt(hiddenList.length), "🚫 vyfiltrovaných správ");
  t(fmt(spared), "💔 bodov damage ušetrených");
  t(fmt(minutes) + " min", "⏳ trápenia, ktoré si nezažil");
  t(fmt(spared * 1000), "🧠 nervových buniek nezabitých");
  t(fmt(Math.round(spared / 2)), "😮‍💨 vzdychov nevydychnutých");
  t(fmt(all.length - hiddenList.length), "🌤️ správ, čo ti nezhoršia deň");
  c2.append(tiles);
  app.append(c2);

  // 3) rozdelenie
  const cnt = { negative: 0, neutral: 0, positive: 0 };
  all.forEach((e) => (cnt[e.c] = (cnt[e.c] || 0) + 1));
  const c3 = el("div", "card");
  c3.append(el("h2", "", "Čo ti web naozaj servíroval"));
  const split = el("div", "split");
  [["negative", "var(--bad)"], ["neutral", "var(--mid)"], ["positive", "var(--good)"]].forEach(([k, col]) => {
    const i = el("i"); i.style.width = (cnt[k] / all.length) * 100 + "%"; i.style.background = col; split.append(i);
  });
  c3.append(split);
  const lg = el("div", "legend");
  const pct = (n) => Math.round((n / all.length) * 100);
  lg.append(el("span", "", `😱 negatívne ${pct(cnt.negative)} % (${cnt.negative})`),
            el("span", "", `😐 neutrálne ${pct(cnt.neutral)} % (${cnt.neutral})`),
            el("span", "", `😊 pozitívne ${pct(cnt.positive)} % (${cnt.positive})`));
  c3.append(lg);
  if (cnt.negative / all.length > 0.4) c3.append(el("div", "legend", "Viac ako 40 % správ je negatívnych. Žiadne prekvapenie."));
  app.append(c3);

  // 4) graf posledných 14 dní
  const c4 = el("div", "card");
  c4.append(el("h2", "", "Ušetrený damage za 14 dní"));
  const per = {};
  Object.values(log).filter(hidden).forEach((e) => { const k = dayKey(e.ts); per[k] = (per[k] || 0) + e.d; });
  const chart = el("div", "chart");
  const labels = [];
  const vals = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(now - i * 864e5); vals.push(per[dayKey(d)] || 0); labels.push(d.getDate() + "." + (d.getMonth() + 1) + "."); }
  const max = Math.max(1, ...vals);
  vals.forEach((v, i) => { const b = el("div", v ? "" : "zero"); b.style.height = Math.max(3, (v / max) * 100) + "%"; b.title = `${labels[i]}: ${v} bodov`; chart.append(b); });
  c4.append(chart);
  const ax = el("div", "axis"); ax.append(el("span", "", labels[0]), el("span", "", "dnes")); c4.append(ax);
  app.append(c4);

}

// Posledná odpoveď AI služby: aby bolo vidno, či problém prichádza zo servera.
function renderDiag(st) {
  const ago = st ? Math.max(0, Math.round((Date.now() - st.ts) / 1000)) : 0;
  const when = ago < 90 ? `pred ${ago} s` : `pred ${Math.round(ago / 60)} min`;
  let t = "";
  if (!st) t = "Zatiaľ žiadna komunikácia s AI službou.";
  else if (st.status === 200) t = `AI služba odpovedala v poriadku (${when}).`;
  else if (st.status === 429) t = `AI služba vrátila limit požiadaviek, HTTP 429 (${when}).`;
  else if (st.status === 0) t = `Spojenie s AI službou zlyhalo (${when}).`;
  else t = `AI služba vrátila HTTP ${st.status}${st.error ? " (" + st.error + ")" : ""} (${when}).`;
  $("#diag").textContent = t;
}

async function load(range) {
  const s = await api.storage.local.get(["dnnLog", "allowNeutral", "dnnSince", "lastProxyStatus"]);
  renderDiag(s.lastProxyStatus);
  render(s.dnnLog || {}, s.allowNeutral !== false, s.dnnSince, range);
}

let range = 1;
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  range = Number(b.dataset.r);
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  load(range);
});
$("#reset").addEventListener("click", async () => {
  if (!confirm("Zmazať celú štatistiku? Hodnotenia v cache ostanú.")) return;
  await api.storage.local.remove(["dnnLog", "dnnSince"]);
  load(range);
});
api.storage.onChanged.addListener(() => load(range));
load(range);
