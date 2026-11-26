// Shared title/variant normaliser for reed products.
// Works in Node (module.exports) and in a browser (window.RN).
(function (root) {
  const LINES = [
    { id: "vd-56", name: "Vandoren 56 Rue Lepic", brand: "Vandoren", re: /\b56\b|rue\s*lepic/i },
    { id: "vd-v21", name: "Vandoren V21", brand: "Vandoren", re: /\bv\s*[.•·-]?\s*21\b/i },
    { id: "vd-v12", name: "Vandoren V12", brand: "Vandoren", re: /\bv\s*[.•·-]?\s*12\b/i },
    { id: "da-reserve", name: "D'Addario Reserve", brand: "D'Addario", re: /reserve/i },
    { id: "rico", name: "Rico by D'Addario", brand: "D'Addario", re: /\brico\b/i },
    { id: "vd-trad", name: "Vandoren Traditional", brand: "Vandoren", re: /vandoren/i },
  ];
  // Things that are not the reeds we compare
  const EXCLUDE = /grease|guard|case|ligature|mouthpiece|cap\b|patch|cushion|holder|clipper|cutter|resurfacer|swab|strap|mix|sampler|oboe|bassoon|juno|java|jazz|v16|\bzz\b|\bv10\b|royal|select|la\s*voz|hemke|plasticover|frederick|venn|evolution\s*mix|grand\s*concert|rigotti|legere|synthetic|contrabass|alto\s*clarinet|tee\s*shirt|t-shirt|poster|book/i;

  function line(title) {
    if (EXCLUDE.test(title)) return null;
    // "Vandoren Traditional" only if no other Vandoren line keyword matched
    for (const l of LINES) if (l.re.test(title)) return l;
    return null;
  }

  function instrument(t) {
    if (/bass\s*clar/i.test(t)) return "Bass clarinet";
    if (/(\beb\b|e\s*-?\s*flat|e♭).*clar/i.test(t)) return "Eb clarinet";
    if (/clarinet|\bclar\b|\bcl\b/i.test(t)) return "Bb clarinet";
    if (/soprano/i.test(t)) return "Soprano sax";
    if (/\balto\b/i.test(t)) return "Alto sax";
    if (/tenor/i.test(t)) return "Tenor sax";
    if (/bari/i.test(t)) return "Baritone sax";
    return null;
  }

  function pack(t) {
    t = String(t || "").replace(/\bthree\b/gi, "3").replace(/\bfive\b/gi, "5").replace(/\bten\b/gi, "10");
    let m =
      t.match(/(?:box|pack|card|pk|set)\s*of\s*(\d{1,2})/i) ||
      t.match(/(\d{1,2})\s*-?\s*(?:pack|pk|pce|pcs|piece|reeds?|ct|count|box)\b/i) ||
      t.match(/\((\d{1,2})\)/) ||
      t.match(/\bx\s*(\d{1,2})\b/i) ||
      t.match(/(\d{1,2})\s*per\s*box/i);
    if (m) return +m[1];
    if (/single|\beach\b|1\s*reed|individual/i.test(t)) return 1;
    return null;
  }

  function strength(s) {
    if (!s) return null;
    s = String(s).replace(/56\s*rue\s*lepic|v\s*[.•·-]?\s*(12|21)\b/gi, " ")
      .replace(/(?:box|pack|card|pk|set)\s*of\s*\d+|(?<![\d.])\d+\s*-?\s*(?:pack|pk|pce|pcs|reeds?|ct|count)\b|\(\d+\)|\d+\s*per\s*box/gi, " ");
    const m = s.match(/(?:strength|size|grade|str\.)\s*:?\s*([1-5](?:\.[05])?)(?![\d.])\s*(\+|plus)?/i) ||
      s.match(/(?:^|[^\d.\w])([1-5](?:\.[05])?)(?![\d.])\s*(\+|plus)?/i);
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (v < 1 || v > 5) return null;
    return v.toFixed(1) + (m[2] ? "+" : "");
  }

  function make(store, title, variantTitle, price, url, inStock, extra) {
    const full = title + " " + (variantTitle || "");
    const l = line(full);
    if (!l) return null;
    const inst = instrument(title) || instrument(full);
    if (!inst) return null;
    const n = pack(title) || pack(variantTitle || "") || (extra && extra.pack) || null;
    const st = strength(variantTitle) || strength(title.replace(/box\s*of\s*\d+|\d+\s*-?\s*(pack|pk|reeds?)/gi, ""));
    const p = typeof price === "string" ? parseFloat(price.replace(/[^\d.]/g, "")) : price;
    if (!p || !n) return null;
    if (p / n < 1.5 || p / n > 30) return null; // implausible per-reed price: pack size misread
    return {
      store, line: l.id, lineName: l.name, instrument: inst, strength: st,
      pack: n, price: +p.toFixed(2), unit: +(p / n).toFixed(2),
      title: title.trim(), variant: (variantTitle || "").trim(), url, inStock: inStock !== false,
    };
  }

  const api = { line, instrument, pack, strength, make, LINES };
  if (typeof module !== "undefined") module.exports = api;
  else root.RN = api;
})(this);
