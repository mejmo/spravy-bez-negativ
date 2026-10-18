(() => {
  // Chrome/Edge: `chrome`, Firefox: `browser` (s promisami)
  const api = globalThis.browser ?? globalThis.chrome;
  const CACHE_KEY = "dnnCache"; // { [v2|zdroj|id|hash]: { c: kategória, t: topic|null } }
  const CACHE_PREFIX = "v2|";   // verzia formátu cache; staršie záznamy (bez topic) sa zahodia a vyžiadajú znova
  const BATCH = 25;
  let cache = {};
  let allowNeutral = true;
  let queue = new Map(); // id -> { title, tiles[] } čakajúce na odoslanie
  const inflight = new Map(); // id -> { title, tiles[] } odoslané alebo čakajúce
  let timer = null;
  const seen = new WeakSet();

  // Titulok: zlúčené biele znaky, najviac 400 znakov (rovnaká normalizácia ako na serveri).
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const norm = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 400);
  // Text bez vložených <script>/<style> (v niektorých titulkoch sú).
  function cleanText(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
    return (c.textContent || "").trim().replace(/\s+/g, " ");
  }
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  // ======== ADAPTÉRY WEBOV ========
  // Adaptér hovorí, ktoré prvky sú správy a ako z nich dostať ID a titulok:
  //   source               doména zdroja (posiela sa na server)
  //   candidates(root)     prvky, ktoré môžu byť správou
  //   extract(el)          {id, title} | {skip:true} | {ad:true} | null (obsah ešte nie je vykreslený)
  //   target(el)           (voliteľné) prvok, ktorý sa skrýva/označuje; predvolene `el`
  //   shadowHostSelector   (voliteľné) hostiteľ shadow DOM, v ktorom žijú správy
  //   adCss                CSS na skrytie reklám na danom webe
  const DENNIKN = {
    source: "dennikn.sk",
    // Widget „Minúta po minúte“ na titulke žije v shadow DOM; hostiteľ má túto triedu.
    shadowHostSelector: ".n3_box__app",
    adCss: `.n3_ad:not(#protag-custom-consent), .proads-space, [id^="remp-banner"],
iframe[id^="google_ads_iframe"], [id$="-ad-unit"], ins.adsbygoogle { display: none !important; }`,
    candidates: (root) => root.querySelectorAll("article.n3_tile, .mnt-Post-hash"),
    extract(el) {
      if (el.matches("article.n3_tile")) {
        const a = el.querySelector(".n3_tile_title a");
        if (!a) {
          // dlaždica „Minúta po minúte“ nemá nadpis; text je v .n3_tile_content, data-beam je "dn_mpm <id>"
          const c = el.classList.contains("n3_tile__minute") && el.querySelector(".n3_tile_content");
          const mm = c && (el.dataset.beam || "").match(/\s(\d{1,12})$/);
          return mm && { id: "m" + mm[1], title: norm(cleanText(c)) };
        }
        // data-beam je napr. "post 5630008" alebo "dn_blog 5613360"; záloha: číslo v ceste URL
        const m = (el.dataset.beam || "").match(/\s(\d{1,12})$/) || a.href.match(/dennikn\.sk\/(?:[a-z-]+\/)?(\d{1,12})\//);
        return m && { id: m[1], title: norm(cleanText(a)) };
      }
      // .mnt-Post-hash má id príspevku; text je v .mnt-article (úvodná veta býva v <strong>)
      const body = el.querySelector(".mnt-article");
      if (!el.id || !body) return null;
      return { id: "m" + el.id, title: norm(cleanText(body)) };
    }
  };

  // cas.sk: <article> neobsahuje odkaz, ale je v ňom obalený (<a><article>…). URL nemá číselné ID, len
  // slug v ceste. Triedy majú hash (SimpleArticleTile_article__heADL), preto sa spoliehame na štruktúru.
  const CAS_FAMILY = /(^|\.)(cas|pluska|trend)\.sk$/;
  const CAS = {
    source: "cas.sk",
    adCss: `[id^="main-advertisement-wrapper"], [class*="ReklamnyBox"], [id^="ad-"][id$="-id"],
iframe[id^="goog_"], iframe[id^="google_ads"], ins.adsbygoogle { display: none !important; }`,
    // <article> dlaždice + textové riadky zoznamu „Najčítanejšie“ (li.*text-article > a), ktoré <article> nemajú
    candidates: (root) => root.querySelectorAll("article, li[class*='text-article']"),
    // Skrývame najvyšší obal, ktorý obsahuje len túto dlaždicu (article > a > div > li), inak ostanú
    // prázdne miesta v mriežke/karuseli. Najviac 4 úrovne a nikdy nie body/main.
    target(article) {
      let el = article;
      for (let i = 0; i < 4; i++) {
        const p = el.parentElement;
        if (!p || p.children.length !== 1 || /^(BODY|MAIN|HTML)$/.test(p.tagName)) break;
        el = p;
      }
      return el;
    },
    extract(article) {
      // Dlaždica je v odkaze (a > article). Samotný otvorený článok (article bez obalového odkazu, vnútri má
      // len odkazy na autora a pod.) sa nikdy nefiltruje. Výnimka: riadok zoznamu li > a.
      const a = article.closest("a[href]") || (article.tagName === "LI" ? article.querySelector("a[href]") : null);
      if (!a) return { skip: true };
      let u;
      try { u = new URL(a.href, location.href); } catch { return { skip: true }; }
      // platený obsah a externé weby (advertoriály) berieme ako reklamu: bez vyhodnotenia
      if (!CAS_FAMILY.test(u.hostname) || /^\/pr-clanky\//.test(u.pathname)) return { ad: true };
      const h = article.querySelector("h1, h2, h3, h4, [class*='title']") || (article.tagName === "LI" ? a : null);
      if (!h) return null;
      const title = norm(cleanText(h));
      const parts = u.pathname.split("/").filter(Boolean);
      let slug = parts[parts.length - 1];
      if (!slug) return { skip: true };
      try { slug = decodeURIComponent(slug); } catch { /* ostane pôvodný */ }
      // videá a rubriky nemajú vlastný slug (napr. /video-space?videoId=123): rozlíšiť podľa videoId alebo titulku
      const vid = u.searchParams.get("videoId");
      if (vid) slug += "-" + vid;
      else if (parts.length < 2) slug += "-" + fnv(title);
      slug = slug.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._:-]/g, "-"); // diakritika -> ASCII
      if (slug.length > 110) slug = slug.slice(0, 100) + "-" + fnv(slug); // ID má najviac 128 znakov
      return { id: "cas.sk:" + slug, title };
    }
  };

  // sme.sk: dlaždice sú div/li s triedou `article-tile` alebo `listing__item`. Väčšina nesie data-url a
  // data-headline; minútové príspevky majú data-js-minute-post-id a text v .listing__item-body. URL článku je
  // /<rubrika>/c/<slug> (aj blog.sme.sk/<autor>/<rubrika>/<slug> a sportnet.sme.sk/spravy/<slug>).
  const SME = {
    source: "sme.sk",
    adCss: `.sme-banner, .pb_item--advert, .advert-placeholder, [id^="minute-advert"], .remp-banner,
ins.adsbygoogle, iframe[id^="google_ads"] { display: none !important; }`,
    candidates: (root) => root.querySelectorAll(".article-tile, .listing__item"),
    extract(el) {
      // minútový príspevok: vlastné ID, text príspevku (nie titulok článku, na ktorý odkazuje)
      if (el.dataset.jsMinutePostId) {
        const body = el.querySelector(".listing__item-body");
        const title = body ? norm(cleanText(body)) : "";
        return title ? { id: "sme.sk:minute-" + el.dataset.jsMinutePostId, title } : null;
      }
      const link = el.querySelector("a.listing-item-text__title[href], h1 a[href], h2 a[href], h3 a[href], h4 a[href], a.article-tile-thumbnail[href]");
      let u;
      try { u = new URL(el.dataset.url || (link && link.href) || "", location.href); } catch { return { skip: true }; }
      if (!/(^|\.)sme\.sk$/.test(u.hostname)) return { skip: true }; // partnerský/externý obsah
      const parts = u.pathname.split("/").filter(Boolean);
      const isArticle = parts.includes("c") || (u.hostname === "sportnet.sme.sk" && parts[0] === "spravy" && parts.length >= 2) ||
        (u.hostname === "blog.sme.sk" && parts.length >= 3);
      if (!isArticle) return { skip: true }; // navigácia, rubriky a pod.
      const ci = parts.indexOf("c");
      // starý tvar /c/<číselné id>/<slug>.html -> číselné ID; inak posledný segment cesty
      let slug = ci >= 0 && /^\d+$/.test(parts[ci + 1] || "") ? parts[ci + 1] : parts[parts.length - 1].replace(/\.html?$/i, "");
      if (!slug) return { skip: true };
      try { slug = decodeURIComponent(slug); } catch { /* ostane pôvodný */ }
      slug = slug.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._:-]/g, "-");
      if (slug.length > 110) slug = slug.slice(0, 100) + "-" + fnv(slug); // ID má najviac 128 znakov
      const h = el.querySelector("h1, h2, h3, h4");
      const title = norm(el.dataset.headline || (h ? cleanText(h) : "") || (link ? cleanText(link) : ""));
      return title ? { id: "sme.sk:" + slug, title } : null;
    }
  };

  const hostname = location.hostname.replace(/^www\./, "");
  const ADAPTER = /(^|\.)sme\.sk$/.test(hostname) ? SME : { "cas.sk": CAS }[hostname] || DENNIKN;
  const SOURCE = ADAPTER.source;

  // Štýly: do dokumentu aj do každého shadow rootu (page CSS ani náš súbor tam nesiaha).
  // V shadow roote nahrádzame `body.dnn-reveal` za `:host(.dnn-reveal)`.
  // Cieľ obrysu: dlaždica sama; pri „Minúte“ vnútorný .mnt-FeedArticle (obal .mnt-Post-hash má nulovú výšku)
  const target = (cat, pseudo = "") => {
    const attr = cat ? `[data-dnn="${cat}"]` : "[data-dnn]";
    return `body.dnn-reveal ${attr}:not(.mnt-Post-hash)${pseudo}, body.dnn-reveal .mnt-Post-hash${attr} .mnt-FeedArticle${pseudo}`;
  };
  const COLORS = { negative: "#dc2626", positive: "#16a34a", neutral: "#ca8a04" };
  const LABELS = { negative: "NEGATÍVNE – skryté", positive: "pozitívne", neutral: "neutrálne" };
  const REVEAL_CSS = [
    `${target()} { position: relative; }`,
    `${target(null, "::after")} { position: absolute; top: 4px; right: 4px; z-index: 5; font: 700 11px/1 system-ui, sans-serif; color: #fff; padding: 4px 6px; border-radius: 4px; }`,
    ...Object.keys(COLORS).map((c) =>
      `${target(c)} { outline: 3px solid ${COLORS[c]}; opacity: 1 !important; } ` +
      `${target(c, "::after")} { content: "${LABELS[c]}"; background: ${COLORS[c]}; }`),
    `body.dnn-reveal .dnn-hidden[data-dnn="neutral"]:not(.mnt-Post-hash)::after, body.dnn-reveal .mnt-Post-hash.dnn-hidden[data-dnn="neutral"] .mnt-FeedArticle::after { content: "neutrálne – skryté"; }`
  ].join(" ");

  const CSS = `
.dnn-pending, .dnn-hidden { display: none !important; }
/* reklamy a promo bannery podľa webu (consent dialóg nechávame na pokoji) */
${ADAPTER.adCss}
.dnn-ad { display: none !important; }
body.dnn-reveal .dnn-hidden { display: block !important; }
${REVEAL_CSS}
#dnn-toggle {
  position: fixed; bottom: 12px; left: 12px; z-index: 99999;
  background: #1f2937; color: #fff; border: 0; border-radius: 8px; cursor: pointer;
  font: 13px/1 system-ui, sans-serif; padding: 10px 12px; box-shadow: 0 2px 8px rgba(0,0,0,.3);
}
#dnn-loader {
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 99999;
  min-width: 260px; max-width: 92vw; background: #1f2937; color: #fff; border-radius: 12px;
  padding: 10px 14px; font: 13px/1.35 system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.35);
}
#dnn-loader .dnn-l-row { display: flex; align-items: center; gap: 8px; }
#dnn-loader .dnn-l-ico { font-size: 20px; display: inline-block; animation: dnn-pulse 1s infinite; }
#dnn-loader.dnn-done .dnn-l-ico { animation: none; }
#dnn-loader .dnn-l-bar { height: 5px; border-radius: 3px; background: rgba(255,255,255,.2); margin-top: 7px; overflow: hidden; }
#dnn-loader .dnn-l-bar i { display: block; height: 100%; width: 0; background: #34d399; transition: width .4s; }
#dnn-loader .dnn-l-sub { opacity: .7; font-size: 11px; margin-top: 3px; }
@keyframes dnn-pulse { 50% { transform: scale(1.25); } }
#dnn-banner {
  position: fixed; bottom: 12px; right: 12px; z-index: 99999;
  background: #1f2937; color: #fff; font: 13px/1.4 system-ui, sans-serif;
  padding: 8px 12px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.3);
  max-width: 320px;
}
#dnn-banner a { color: #93c5fd; cursor: pointer; text-decoration: underline; }
`;

  const keep = (cat) => cat === "positive" || (allowNeutral && cat === "neutral");

  function addStyle(root, css) {
    const st = document.createElement("style");
    st.textContent = css;
    (root === document ? document.head : root).appendChild(st);
  }
  addStyle(document, CSS);

  // ---- shadow rooty ----
  const observedRoots = new Set([document]);
  const shadowHosts = new Set();

  function discoverRoots() {
    if (!ADAPTER.shadowHostSelector) return;
    document.querySelectorAll(ADAPTER.shadowHostSelector).forEach((host) => {
      const sr = host.openOrClosedShadowRoot || api.dom?.openOrClosedShadowRoot?.(host) || host.shadowRoot;
      if (!sr || observedRoots.has(sr)) return;
      observedRoots.add(sr);
      shadowHosts.add(host);
      addStyle(sr, CSS.replaceAll("body.dnn-reveal", ":host(.dnn-reveal)"));
      if (document.body.classList.contains("dnn-reveal")) host.classList.add("dnn-reveal");
      new MutationObserver(scan).observe(sr, { childList: true, subtree: true });
    });
  }

  function apply(tile, cat) {
    tile.dataset.dnn = cat;
    tile.classList.remove("dnn-pending");
    tile.classList.toggle("dnn-hidden", !keep(cat));
  }

  function banner(text) {
    let b = document.getElementById("dnn-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "dnn-banner";
      document.body.appendChild(b);
    }
    b.textContent = text;
    clearTimeout(banner.t);
    banner.t = setTimeout(() => b.remove(), 10000);
  }

  // Kľúč cache: verzia formátu, zdroj, ID aj normalizovaný titulok (hash), nie iba ID.
  const ckey = (source, id, title) => `${CACHE_PREFIX}${source}|${id}|${fnv(title)}`;
  const validEntry = (v) => v && typeof v === "object" && ["positive", "neutral", "negative"].includes(v.c);

  const LOG_KEY = "dnnLog"; // { [id]: { t: titulok, c: kategória, d: damage 0-10, p: topic|null, src: zdroj, ts: čas, s: "article"|"minute" } }

  // Zlúči nové hodnotenia s tým, čo už je v úložisku (iné karty ho mohli doplniť).
  let saveChain = Promise.resolve();
  function saveCache(fresh, freshLog) {
    // zápisy po jednom, aby si paralelné dávky neprepisovali cache navzájom
    saveChain = saveChain.then(() => doSaveCache(fresh, freshLog)).catch(() => {});
    return saveChain;
  }
  async function doSaveCache(fresh, freshLog) {
    const stored = await api.storage.local.get([CACHE_KEY, LOG_KEY, "dnnSince"]);
    const merged = { ...(stored[CACHE_KEY] || {}), ...fresh };
    Object.keys(merged).forEach((k) => { if (!k.startsWith(CACHE_PREFIX) || !validEntry(merged[k])) delete merged[k]; }); // staré formáty
    const keys = Object.keys(merged);
    if (keys.length > 5000) keys.slice(0, keys.length - 4000).forEach((k) => delete merged[k]);

    const log = { ...(stored[LOG_KEY] || {}), ...freshLog };
    const ids = Object.keys(log);
    if (ids.length > 4000) {
      ids.sort((a, b) => log[a].ts - log[b].ts).slice(0, ids.length - 3000).forEach((k) => delete log[k]);
    }
    await api.storage.local.set({
      [CACHE_KEY]: merged,
      [LOG_KEY]: log,
      dnnSince: stored.dnnSince || Date.now()
    });
    Object.assign(cache, merged);
  }

  // ---- indikátor načítania: „počítam mentálny damage“ ----
  const LOADER_MSGS = [
    "Meriam, koľko ťa dnešné správy ubijú…",
    "Rátam nervové bunky v ohrození…",
    "Zisťujem, kto dnes zase čo pokazil…",
    "Odpočítavam body mentálneho damage…",
    "Triedim katastrofy podľa závažnosti…",
    "Pripravujem ti ochranu pred realitou…"
  ];
  const run = { total: 0, done: 0, spared: 0, hiddenCount: 0 };
  let loaderEl = null, loaderMsgTimer = null, loaderDoneTimer = null, loaderMsgIdx = 0;

  function loaderEnsure() {
    if (loaderEl) return loaderEl;
    loaderEl = document.createElement("div");
    loaderEl.id = "dnn-loader";
    loaderEl.innerHTML = '<div class="dnn-l-row"><span class="dnn-l-ico">🧠</span><span class="dnn-l-txt"></span></div>' +
      '<div class="dnn-l-bar"><i></i></div><div class="dnn-l-sub"></div>';
    document.body.appendChild(loaderEl);
    return loaderEl;
  }
  function loaderHide() {
    clearInterval(loaderMsgTimer); loaderMsgTimer = null;
    clearTimeout(loaderDoneTimer); loaderDoneTimer = null;
    loaderEl?.remove(); loaderEl = null;
    run.total = run.done = run.spared = run.hiddenCount = 0;
  }
  // Text sa prepíše len pri zmene: zápis do DOM spúšťa MutationObserver -> scan -> loaderUpdate (nekonečná slučka).
  const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  function loaderUpdate() {
    if (run.total === 0) return;
    const el = loaderEnsure();
    const ico = el.querySelector(".dnn-l-ico"), txt = el.querySelector(".dnn-l-txt"),
      bar = el.querySelector(".dnn-l-bar i"), sub = el.querySelector(".dnn-l-sub");
    if (run.done < run.total) {
      clearTimeout(loaderDoneTimer); loaderDoneTimer = null;
      el.classList.remove("dnn-done");
      setText(ico, "🧠");
      if (!loaderMsgTimer) {
        loaderMsgTimer = setInterval(() => {
          loaderMsgIdx = (loaderMsgIdx + 1) % LOADER_MSGS.length;
          if (loaderEl && !loaderEl.classList.contains("dnn-done")) setText(loaderEl.querySelector(".dnn-l-txt"), LOADER_MSGS[loaderMsgIdx]);
        }, 2500);
        setText(txt, LOADER_MSGS[loaderMsgIdx]);
      }
      bar.style.width = Math.round((run.done / run.total) * 100) + "%";
      setText(sub, `Vyhodnotených ${run.done} / ${run.total} správ`);
    } else {
      clearInterval(loaderMsgTimer); loaderMsgTimer = null;
      el.classList.add("dnn-done");
      setText(ico, run.hiddenCount ? "🛡️" : "😌");
      setText(txt, run.hiddenCount
        ? `Hotovo. Schovaných ${run.hiddenCount} správ, ušetrených ${run.spared} bodov damage. Nemáš za čo.`
        : "Hotovo. Prekvapivo nič strašné. Zatiaľ.");
      bar.style.width = "100%";
      setText(sub, "");
      if (!loaderDoneTimer) loaderDoneTimer = setTimeout(loaderHide, 4000);
    }
  }

  // Neúspešné položky ostanú viditeľné (nič neoznačujeme ako negatívne). Do obnovenia stránky sa
  // pre ne už nič neposiela, takže žiadne slučky ani čakanie.
  function release(entries) {
    loaderHide();
    entries.forEach(([id, v]) => {
      inflight.delete(id);
      v.tiles.forEach((t) => t.classList.remove("dnn-pending"));
    });
  }

  function failureMessage(resp) {
    switch (resp.error) {
      case "rate_limited": return "Správy bez negatív: AI služba je teraz preťažená, správy ostávajú nevyhodnotené.";
      case "budget_exhausted": return "Správy bez negatív: dnes sa minuli AI kredity, správy ostávajú nevyhodnotené.";
      case "bad_request":
      case "config": return "Správy bez negatív: AI služba je nedostupná, správy ostávajú nevyhodnotené.";
      default: return "Správy bez negatív: vyhodnotenie sa nepodarilo, správy ostávajú nevyhodnotené.";
    }
  }

  const CONCURRENCY = 4; // paralelné dávky

  // Vyhodnotí jednu dávku (viac dávok môže bežať súčasne).
  async function processChunk(chunk) {
    const byId = new Map(chunk);
    const items = chunk.map(([id, v]) => ({ id, title: v.title, source: SOURCE }));
    let resp;
    try {
      resp = await api.runtime.sendMessage({ type: "classify", items });
    } catch (e) {
      resp = { ok: false, error: "network" };
    }
    resp = resp || { ok: false, error: "network" };

    // použijeme všetky platné výsledky (aj pri čiastočnom zlyhaní)
    const fresh = {};
    const freshLog = {};
    const done = new Set();
    for (const r of resp.results || []) {
      const entry = byId.get(String(r.id));
      if (!entry || done.has(String(r.id))) continue;
      done.add(String(r.id));
      entry.ckeys.forEach((k) => { fresh[k] = { c: r.category, t: r.topic ?? null }; });
      freshLog[r.id] = {
        t: entry.title.slice(0, 160), c: r.category, d: r.damage ?? 0, p: r.topic ?? null, src: SOURCE,
        ts: Date.now(), s: SOURCE === "dennikn.sk" && String(r.id).startsWith("m") ? "minute" : "article"
      };
      entry.tiles.forEach((t) => apply(t, r.category));
      inflight.delete(String(r.id));
      run.done++;
      if (!keep(r.category)) { run.hiddenCount++; run.spared += r.damage ?? 0; }
    }
    if (done.size) { loaderUpdate(); await saveCache(fresh, freshLog); }

    const missing = chunk.filter(([id]) => !done.has(id));
    if (missing.length) {
      banner(failureMessage(resp.ok ? { error: "bad_response" } : resp));
      release(missing);
    }
  }

  // Čo je na obrazovke (alebo najbližšie k nej) ide na vyhodnotenie prvé.
  const priority = (entry) => entry.pri;

  async function flush() {
    timer = null;
    const entries = [...queue.entries()].sort((x, y) => priority(x[1]) - priority(y[1]));
    queue = new Map();
    const chunks = [];
    for (let i = 0; i < entries.length; i += BATCH) chunks.push(entries.slice(i, i + BATCH));
    let next = 0;
    const worker = async () => { while (next < chunks.length) await processChunk(chunks[next++]); };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  }

  function scan() {
    discoverRoots();
    observedRoots.forEach((root) => ADAPTER.candidates(root).forEach((cand) => {
      if (seen.has(cand)) return;
      if (!cand.getClientRects().length) return; // nevykreslené (skrytá kópia, zatvorená záložka): zbytočne neplytvať vyhodnotením
      const item = ADAPTER.extract(cand);
      if (item && item.skip) { seen.add(cand); return; }
      const tile = ADAPTER.target ? ADAPTER.target(cand) : cand;
      if (item && item.ad) { seen.add(cand); tile.classList.add("dnn-ad"); return; } // platený obsah: skryť bez vyhodnotenia
      if (!item || !ID_RE.test(item.id) || !item.title) return; // obsah ešte nie je vykreslený: skúsime znova
      const { id, title } = item;
      const key = ckey(SOURCE, id, title);

      seen.add(cand);
      if (validEntry(cache[key])) return apply(tile, cache[key].c);
      const pri = Math.abs(cand.getBoundingClientRect().top); // zmerať skôr, než prvok skryje trieda pending
      tile.classList.add("dnn-pending");
      // ten istý článok na stránke viackrát / už rozbehnutý dotaz -> bez ďalšieho volania API
      const existing = inflight.get(id);
      if (existing) { existing.ckeys.add(key); return existing.tiles.push(tile); }
      run.total++;
      const entry = { title, ckeys: new Set([key]), pri, tiles: [tile] };
      inflight.set(id, entry);
      queue.set(id, entry);
    }));
    if (queue.size && !timer) timer = setTimeout(flush, 150);
    if (run.total) loaderUpdate();
  }

  function countHidden() {
    let n = 0;
    observedRoots.forEach((r) => (n += r.querySelectorAll(".dnn-hidden").length));
    return n;
  }

  function addToggle() {
    const btn = document.createElement("button");
    btn.id = "dnn-toggle";
    const label = () => {
      const on = document.body.classList.contains("dnn-reveal");
      btn.textContent = on ? "Skryť negatívne správy" : `Zobraziť skryté správy (${countHidden()})`;
    };
    btn.onclick = () => {
      const on = document.body.classList.toggle("dnn-reveal");
      shadowHosts.forEach((h) => h.classList.toggle("dnn-reveal", on));
      label();
    };
    document.body.appendChild(btn);
    setInterval(label, 1000);
    label();
  }

  async function init() {
    addToggle();
    const s = await api.storage.local.get([CACHE_KEY, "allowNeutral"]);
    // cache v2: staršie záznamy (bez témy) nepovažujeme za úplné, vyžiadajú sa znova
    cache = Object.fromEntries(Object.entries(s[CACHE_KEY] || {}).filter(([k, v]) => k.startsWith(CACHE_PREFIX) && validEntry(v)));
    allowNeutral = s.allowNeutral !== false;
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    // shadow root sa môže objaviť až po načítaní React aplikácie
    setInterval(scan, 1500);

    api.storage.onChanged.addListener((ch) => {
      if (!ch.allowNeutral) return;
      allowNeutral = ch.allowNeutral.newValue !== false;
      observedRoots.forEach((root) => root.querySelectorAll("[data-dnn]").forEach((tile) => apply(tile, tile.dataset.dnn)));
    });
  }
  init();
})();
