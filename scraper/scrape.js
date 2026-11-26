// ReedShelf daily price collector. Node 20+, no dependencies.
// Usage: node scraper/scrape.js > prices.json
const R = require("./normalize");
const UA = "Mozilla/5.0 (compatible; ReedShelfPriceCheck/1.0; +https://reedshelf.netlify.app)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(...a);

async function get(url, type = "text") {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: type === "json" ? "application/json" : "text/html,*/*" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      await sleep(400); // be polite
      return type === "json" ? r.json() : r.text();
    } catch (e) {
      log("  retry", url, e.message);
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}
const decode = (s) => (s || "").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&#39;|&#x27;|&rsquo;|’/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const strip = (s) => decode((s || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
const jsonLds = (html) => [...(html || "").matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean).flatMap((j) => (j["@graph"] ? j["@graph"] : [j]));
const brandish = /vandoren|rico|reserve|d.?addario/i;

// One offer = one pack at one store, possibly covering several strengths.
function offer(store, title, strengths, price, url, inStock, packHint) {
  const o = R.make(store, title, "", price, url, inStock, { pack: packHint });
  if (!o) return null;
  const st = (strengths || []).map(R.strength).filter(Boolean);
  if (st.length) o.strengths = [...new Set(st)];
  else o.strengths = o.strength ? [o.strength] : [];
  delete o.strength; delete o.variant;
  return o;
}

// ---------- Shopify (products.json) ----------
async function shopify(store, base, collections) {
  const out = [], seen = new Set();
  for (const collection of [].concat(collections)) {
    for (let p = 1; p < 10; p++) {
      const j = await get(`${base}/collections/${collection}/products.json?limit=250&page=${p}`, "json");
      if (!j || !j.products || !j.products.length) break;
      for (const x of j.products) {
        if (seen.has(x.handle)) continue;
        seen.add(x.handle);
        if (!brandish.test(x.title + " " + x.vendor)) continue;
        // some stores leave the brand out of the title ("Alto Saxophone Reeds Box of 10", vendor RICO)
        const title = /vandoren|rico|reserve/i.test(x.title) ? x.title : (x.vendor || "") + " " + x.title;
        const url = `${base}/products/${x.handle}`;
        const groups = {}; // price|stock -> strengths
        for (const v of x.variants) {
          const k = v.price + "|" + (v.available ? 1 : 0);
          (groups[k] = groups[k] || []).push(v.title === "Default Title" ? title : v.title);
        }
        for (const [k, sts] of Object.entries(groups)) {
          const [price, av] = k.split("|");
          const o = offer(store, title, sts, price, url, av === "1");
          if (o) out.push(o);
        }
      }
    }
  }
  return out;
}

// ---------- WooCommerce (public Store API) ----------
async function woo(store, base) {
  const out = [], seen = new Set();
  for (const q of ["vandoren", "rico", "reserve"]) {
    for (let p = 1; p < 8; p++) {
      const j = await get(`${base}/wp-json/wc/store/v1/products?per_page=100&page=${p}&search=${q}`, "json");
      if (!Array.isArray(j) || !j.length) break;
      for (const x of j) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        const name = decode(x.name);
        if (!/reed/i.test(name)) continue;
        const pr = x.prices || {};
        const price = +pr.price / Math.pow(10, pr.currency_minor_unit ?? 2);
        const sts = (x.variations || []).map((v) => (v.attributes || []).map((a) => String(a.value).replace(/^size-?/i, "").replace(/^(\d)-(\d)$/, "$1.$2")).join(" "));
        const o = offer(store, name, sts.length ? sts : [name], price, x.permalink, x.is_in_stock !== false);
        if (o) out.push(o);
      }
      if (j.length < 100) break;
    }
  }
  return out;
}

// ---------- Manny's (headless Shopify: sitemap + JSON-LD) ----------
async function mannys() {
  const base = "https://www.mannys.com.au";
  let xml = await get(base + "/sitemap.xml");
  let locs = [...(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const subs = locs.filter((l) => /sitemap.*\.xml/i.test(l));
  for (const s of subs) { const x = await get(s); locs.push(...[...(x || "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])); }
  const urls = [...new Set(locs.filter((u) => /\/products\//.test(u) && /reed/i.test(u) && /vandoren|rico|reserve|daddario/i.test(u)))];
  log("  mannys candidate pages", urls.length);
  const out = [];
  for (const u of urls) {
    const h = await get(u);
    const p = jsonLds(h).find((j) => j["@type"] === "Product");
    if (!p || !p.offers) continue;
    const of = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    const brand = (p.brand && p.brand.name) || "";
    const title = decode(/vandoren|rico|reserve/i.test(p.name) ? p.name : brand + " " + p.name);
    const o = offer("mannys", title.replace(/Royal by D'Addario/i, "Rico Royal"), [title], of.price, u, /InStock/i.test(of.availability || ""));
    if (o) out.push(o);
  }
  return out;
}

// ---------- Oz Winds (Magento category pages) ----------
async function ozwinds() {
  const base = "https://www.ozwinds.com.au";
  const cats = [
    "accessories/reeds/clarinet-reeds/clarinet-reeds-b-flat",
    "accessories/reeds/clarinet-reeds/clarinet-reeds-bass",
    "accessories/reeds/saxophone-reeds/saxophone-reeds-soprano",
    "accessories/reeds/saxophone-reeds/saxophone-reeds-alto",
    "accessories/reeds/saxophone-reeds/saxophone-reeds-tenor",
    "accessories/reeds/saxophone-reeds/saxophone-reeds-baritone",
  ];
  const seen = new Set(), out = [];
  for (const c of cats) {
    for (let p = 1; p < 8; p++) {
      const h = await get(`${base}/${c}.html?p=${p}&product_list_limit=36`);
      if (!h) break;
      const chunks = h.split(/class="product-item-info"/).slice(1);
      let fresh = 0;
      for (const ch of chunks) {
        const a = ch.match(/class="product-item-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) || ch.match(/href="([^"]+)"[^>]*class="product-item-link"[^>]*>([\s\S]*?)<\/a>/);
        if (!a) continue;
        const url = a[1], name = strip(a[2]);
        if (seen.has(url)) continue;
        seen.add(url); fresh++;
        if (!brandish.test(name) || !R.line(name)) continue;
        const pr = ch.match(/data-price-type="finalPrice"[^>]*data-price-amount="([\d.]+)"/) || ch.match(/data-price-amount="([\d.]+)"[^>]*data-price-type="finalPrice"/);
        if (!pr) continue;
        let title = name, inStock = !/out of stock/i.test(ch);
        if (!R.pack(name)) {
          const ph = await get(url);
          const t = strip((ph || "").match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
          const md = decode((ph || "").match(/<meta name="description" content="([^"]*)"/i)?.[1] || "");
          const pk = R.pack(t) || R.pack(md);
          if (pk) title = name + ` (box of ${pk})`;
          if (ph && /out of stock/i.test(strip(ph.match(/class="stock[^"]*"[\s\S]{0,200}/)?.[0] || ""))) inStock = false;
        }
        const o = offer("ozwinds", title, [], pr[1], url, inStock);
        if (o) out.push(o);
      }
      if (!fresh) break;
    }
  }
  return out;
}

// ---------- Sax & Woodwind (DNN / Revindex) ----------
async function saxwood() {
  const base = "https://www.saxandwoodwind.com.au";
  const out = [];
  for (const c of ["clarinets-reeds", "saxophones-reeds"]) {
    for (let p = 1; p < 12; p++) {
      const h = await get(`${base}/Shop/${c}/rvdsfpvn/${p}`);
      if (!h) break;
      const boxes = h.split(/class="rvdsf-product-container/).slice(1);
      if (!boxes.length) break;
      for (const b of boxes) {
        const name = decode(b.match(/<img[^>]*alt="([^"]*)"/)?.[1] || "");
        const url = b.match(/href="([^"]*\/Product\/[^"]+)"/)?.[1];
        if (!url || !brandish.test(name) || !R.line(name)) continue;
        const ph = await get(url);
        if (!ph) continue;
        const ld = jsonLds(ph).find((j) => j["@type"] === "Product") || {};
        const desc = strip(ld.description || "");
        const pk = R.pack(name) || R.pack(desc);
        const sel = ph.match(/<select[\s\S]*?<\/select>/i)?.[0] || "";
        const sts = [...sel.matchAll(/<option[^>]*>([^<]*)<\/option>/gi)].map((m) => m[1]).filter((t) => !/special order|choose|select/i.test(t));
        let price = null;
        const offers = ld.offers ? [].concat(ld.offers) : [];
        if (offers.length) price = Math.min(...offers.map((o) => +(o.price || o.lowPrice)).filter(Boolean));
        if (!price) { const ps = strip(b).match(/\$[\d,]+\.\d\d/g) || []; price = ps.length ? ps[ps.length - 1] : null; }
        const o = offer("saxwood", name + (pk ? ` (box of ${pk})` : ""), sts, price, url, !/sold out|out of stock/i.test(strip(b)));
        if (o) out.push(o);
      }
      if (!h.includes(`rvdsfpvn/${p + 1}`)) break;
    }
  }
  return out;
}

// ---------- Fine Music (Drupal: sitemap + ProductGroup JSON-LD) ----------
async function finemusic() {
  const base = "https://finemusiconline.com.au";
  const x = await get(base + "/sitemap_accessories.xml");
  const urls = [...(x || "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /reed/i.test(u) && /vandoren|rico|reserve/i.test(u));
  log("  finemusic candidate pages", urls.length);
  const out = [];
  for (const u of urls) {
    const h = await get(u);
    for (const j of jsonLds(h)) {
      const vars = j["@type"] === "ProductGroup" ? j.hasVariant || [] : j["@type"] === "Product" ? [j] : [];
      const groups = {};
      for (const v of vars) {
        const of = [].concat(v.offers || [])[0];
        if (!of) continue;
        const k = of.price + "|" + (/InStock/i.test(of.availability) ? 1 : 0) + "|" + (R.pack(v.name) || "");
        (groups[k] = groups[k] || { name: decode(v.name), sts: [] }).sts.push(decode(v.name));
      }
      for (const [k, g] of Object.entries(groups)) {
        const [price, av] = k.split("|");
        const o = offer("finemusic", g.name, g.sts, price, u, av === "1");
        if (o) out.push(o);
      }
    }
  }
  return out;
}

// Oz Winds, Fine Music and Music Place refuse automated requests (HTTP 403 / bot check),
// so they are not collected. ozwinds() and finemusic() are kept for if that changes.
const STORES = {
  turra: { name: "Turramurra Music", state: "NSW", site: "https://www.turramusic.com.au", run: () => shopify("turra", "https://www.turramusic.com.au", "band-and-orchestral-woodwind-accessories") },
  better: { name: "Better Music", state: "ACT", site: "https://www.bettermusic.com.au", run: () => shopify("better", "https://www.bettermusic.com.au", "woodwind-reeds") },
  mannys: { name: "Manny's Music", state: "VIC", site: "https://www.mannys.com.au", run: mannys },
  saxwood: { name: "Sax & Woodwind", state: "NSW", site: "https://www.saxandwoodwind.com.au", run: saxwood },
  engadine: { name: "Engadine Music", state: "NSW", site: "https://engadinemusic.com.au", run: () => shopify("engadine", "https://engadinemusic.com.au", ["reeds", "vandoren-reeds"]) },
  sieffs: { name: "Sieffs Music", state: "NSW", site: "https://sieffsmusic.com.au", run: () => shopify("sieffs", "https://sieffsmusic.com.au", ["clarinet-reeds", "saxophone-reeds"]) },
  junction: { name: "Music Junction", state: "VIC", site: "https://www.musicjunction.com.au", run: () => shopify("junction", "https://www.musicjunction.com.au", "reeds") },
  perth: { name: "Perth Music Shop", state: "WA", site: "https://perthmusicshop.com.au", run: () => shopify("perth", "https://perthmusicshop.com.au", "woodwind-reeds") },
  vivace: { name: "Vivace Music", state: "QLD", site: "https://www.vivacemusic.com.au", run: () => woo("vivace", "https://www.vivacemusic.com.au") },
  angkor: { name: "Angkor Music", state: "VIC", site: "https://angkormusic.com.au", run: () => woo("angkor", "https://angkormusic.com.au") },
  woods: { name: "Woods Music", state: "", site: "https://woodsmusic.com.au", run: () => woo("woods", "https://woodsmusic.com.au") },
};

(async () => {
  const fs = require("fs");
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync("prices.json", "utf8")); } catch {}
  const offers = [], status = {};
  for (const [id, s] of Object.entries(STORES)) {
    log("Store", id);
    let list = [];
    try { list = await s.run(); } catch (e) { log("  FAILED", e.message); }
    // If a store fails today, keep yesterday's rows but flag them as stale
    if (!list.length && prev.offers) {
      list = prev.offers.filter((o) => o.store === id).map((o) => ({ ...o, stale: true }));
      status[id] = { ok: false, count: list.length, checked: prev.stores?.[id]?.checked || null };
    } else status[id] = { ok: true, count: list.length, checked: new Date().toISOString() };
    log("  offers", list.length);
    offers.push(...list);
  }
  const stores = {};
  for (const [id, s] of Object.entries(STORES)) stores[id] = { name: s.name, state: s.state, site: s.site, ...status[id] };
  const result = { updated: new Date().toISOString(), stores, offers };
  fs.writeFileSync("prices.json", JSON.stringify(result));
  log("Total offers", offers.length);
})();
