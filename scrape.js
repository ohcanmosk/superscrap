// SuperScrap - descarga una "foto" de los precios de Dia, Coto y Carrefour a data/*.json
// La usa GitHub Actions todos los días, así la versión web (GitHub Pages) tiene
// datos de Dia y Carrefour aunque el navegador del celular no pueda consultarlos directo.
// También guarda data/dia-stock.json y data/carrefour-stock.json con el stock de los locales de "mi zona".
// Histórico: en GitHub Actions (o con --historial) agrega una "toma" a data/historial/<categoría>.json
// con el precio sin promo y con promo de cada producto de la categoría; se guardan los últimos 60 días.
// Descuentos con billeteras/bancos (Mercado Pago, MODO...): data/promos.json, ver promos.js.
// Uso: node scrape.js [--historial]

const fs = require("fs");
const path = require("path");

const { CATEGORIAS, ZONA, SIMULATION } = require("./categorias.js");
const { tamano, tamanoCoto, vtexOffer, cotoOffer, matchesCat } = require("./comun.js");
const { bajarPromos } = require("./promos.js");
// Las URLs salen de categorias.js (las mismas que usa index.html). Clave = nombre del archivo.
const SOURCES = {}; // nombre → { url, store, cat }
for (const [cat, c] of Object.entries(CATEGORIAS)) {
  c.dia.forEach((u, i) => { SOURCES[c.snap.dia[i]] = { url: u, store: "dia", cat }; });
  SOURCES[c.snap.coto] = { url: c.coto, store: "coto", cat };
  (c.carrefour || []).forEach((u, i) => { SOURCES[c.snap.carrefour[i]] = { url: u, store: "carrefour", cat }; });
}
const HEADERS = { "user-agent": "Mozilla/5.0 (SuperScrap)", accept: "application/json" };

// Coto devuelve ~1 MB; nos quedamos solo con los campos que usa la app
// (más la disponibilidad de las sucursales de "mi zona": product.sDisp_<sucursal>).
const COTO_KEEP = ["sku.displayName", "product.displayName", "product.category", "sku.activePrice",
  "product.dtoDescuentos", "sku.dtoPrice", "sku.repositoryId", "product.brand",
  "product.mediumImage.url", "product.LCLASE", "sku.referencePrice"];
const COTO_STOCK_RX = new RegExp(`^product\\.sdisp_(${ZONA.coto.map(s => s.id).join("|")})$`, "i");
function trimCoto(j) {
  let recs = null;
  (function w(o) {
    if (recs) return;
    if (Array.isArray(o)) o.forEach(w);
    else if (o && typeof o === "object") {
      if (o.records && o["@type"] && Array.isArray(o.records)) { recs = o.records; return; }
      for (const k in o) w(o[k]);
    }
  })(j);
  if (!recs) throw new Error("Coto: no se encontraron productos");
  return {
    "@type": "Snapshot",
    records: recs.map(r => {
      const a = r.records?.[0]?.attributes || {};
      return {
        detailsAction: { recordState: r.detailsAction?.recordState || "" },
        records: [{ attributes: Object.fromEntries(Object.keys(a)
          .filter(k => COTO_KEEP.includes(k) || COTO_STOCK_RX.test(k)).map(k => [k, a[k]])) }],
      };
    }),
  };
}

// Dia y Carrefour (VTEX).
function trimVtex(list) {
  return list.map(p => {
    const it = p.items?.[0] || {}; const o = it.sellers?.[0]?.commertialOffer || {};
    return {
      productId: p.productId, productName: p.productName, brand: p.brand, link: p.link, categories: p.categories,
      items: [{ itemId: it.itemId, images: (it.images || []).slice(0, 1).map(i => ({ imageUrl: i.imageUrl })),
        sellers: [{ commertialOffer: { Price: o.Price, ListPrice: o.ListPrice, IsAvailable: o.IsAvailable,
          AvailableQuantity: o.AvailableQuantity,
          Teasers: (o.Teasers || []).map(t => ({ Name: t["<Name>k__BackingField"] || t.Name })) } }] }],
    };
  });
}

// Stock de los locales de "mi zona" (Dia y Carrefour): una compra simulada por local, sin código postal,
// con todos los productos (de a 50). Devuelve { <seller>: { <sku>: unidades } }.
async function vtexStock(storeId, skus) {
  const out = {};
  for (const t of ZONA[storeId]) {
    out[t.id] = {};
    for (let i = 0; i < skus.length; i += 50) {
      const chunk = skus.slice(i, i + 50);
      const r = await fetch(SIMULATION[storeId], { method: "POST", headers: { ...HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ items: chunk.map(id => ({ id, quantity: 99, seller: t.id })), country: "ARG" }) });
      if (!r.ok) throw new Error(`${t.label}: HTTP ${r.status}`);
      const j = await r.json();
      (j.items || []).forEach(it => { out[t.id][it.id] = it.availability === "available" ? it.quantity : 0; });
    }
  }
  return out;
}

// ---------- Histórico ----------
const HIST_DIAS = 60;
const GUARDAR_HISTORIAL = process.env.GITHUB_ACTIONS === "true" || process.argv.includes("--historial");
const r2 = n => n == null ? null : Math.round(n * 100) / 100;
// Productos de la categoría en la toma actual: { "<súper>:<id>": { nombre, marca, súper, tamaño, unidad, precios } }.
function productosHistorial(cat, store, j) {
  const c = CATEGORIAS[cat], out = {};
  const add = (id, name, brand, o) => {
    if (!o || !name || !matchesCat({ name, brand }, c)) return;
    const sz = store === "coto" ? tamanoCoto(name, c, o) : tamano(name, c);
    if (cat === "leche" && (sz.size < 0.5 || sz.size > 2)) return;
    const best = o.promos.reduce((b, x) => !b || x.unit < b.unit ? x : b, null);
    out[store + ":" + id] = {
      info: [name, (brand || "").toUpperCase(), store, sz ? r2(sz.size) : null, sz ? sz.unit : null],
      // [precio sin promo, precio de lista, mejor precio c/u con promo, unidades que pide la promo, texto de la promo]
      precio: [r2(o.shelf), r2(o.list), best ? r2(best.unit) : null, best ? best.qty : null, best ? best.text : null],
    };
  };
  if (store === "coto") {
    j.records.forEach(r => {
      const a = r.records?.[0]?.attributes || {}; const g = k => (a[k] || [])[0];
      if (c.cotoCategory && !c.cotoCategory.test((g("product.category") || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())) return;
      add(g("sku.repositoryId"), g("sku.displayName") || g("product.displayName"), g("product.brand"), cotoOffer(a));
    });
  } else j.forEach(p => add(p.productId, p.productName, p.brand, vtexOffer(p, store)));
  return out;
}
function guardarHistorial(out, porCat, ahora) {
  const dir = path.join(out, "historial");
  fs.mkdirSync(dir, { recursive: true });
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(ahora);
  const limite = new Date(ahora.getTime() - HIST_DIAS * 864e5).toISOString();
  for (const [cat, prods] of Object.entries(porCat)) {
    const f = path.join(dir, cat + ".json");
    let h = { v: 1, productos: {}, tomas: [] };
    try { h = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    const toma = { t: ahora.toISOString(), d: dia, p: {} };
    for (const [k, v] of Object.entries(prods)) { h.productos[k] = v.info; toma.p[k] = v.precio; }
    h.tomas = h.tomas.filter(x => x.t >= limite).concat(toma);
    // Se borran los productos que ya no aparecen en ninguna toma.
    const vivos = new Set(h.tomas.flatMap(x => Object.keys(x.p)));
    for (const k of Object.keys(h.productos)) if (!vivos.has(k)) delete h.productos[k];
    fs.writeFileSync(f, JSON.stringify(h));
    console.log(`historial/${cat}: ${Object.keys(prods).length} productos, ${h.tomas.length} tomas`);
  }
}

(async () => {
  const out = path.join(__dirname, "data");
  const porCat = {}; // historial: categoría → productos de esta toma
  fs.mkdirSync(out, { recursive: true });
  const meta = { updated: new Date().toISOString(), ok: {}, errors: {} };
  const skus = { dia: new Set(), carrefour: new Set() };
  for (const [key, { url, store, cat }] of Object.entries(SOURCES)) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error("HTTP " + r.status);
      let j = await r.json();
      j = store === "coto" ? trimCoto(j) : trimVtex(j);
      const n = Array.isArray(j) ? j.length : j.records.length;
      if (!n) throw new Error("respuesta vacía");
      if (skus[store]) j.forEach(p => p.items[0].itemId && skus[store].add(p.items[0].itemId));
      porCat[cat] = Object.assign(porCat[cat] || {}, productosHistorial(cat, store, j));
      fs.writeFileSync(path.join(out, key + ".json"), JSON.stringify(j));
      meta.ok[key] = n;
      console.log(`${key}: ${n} productos`);
    } catch (e) {
      meta.errors[key] = e.message;
      console.error(`${key}: ERROR ${e.message}`);
    }
  }
  for (const s of Object.keys(skus)) {
    const key = s + "-stock";
    try {
      const stock = await vtexStock(s, [...skus[s]]);
      fs.writeFileSync(path.join(out, key + ".json"), JSON.stringify({ updated: meta.updated, stock }));
      meta.ok[key] = skus[s].size;
      console.log(`${key}: ${skus[s].size} productos en ${ZONA[s].length} locales`);
    } catch (e) {
      meta.errors[key] = e.message;
      console.error(`${key}: ERROR ${e.message}`);
    }
  }
  // Descuentos con medios de pago. Si un súper falla, se conservan sus promos anteriores (las que sigan vigentes).
  try {
    const f = path.join(out, "promos.json");
    const nuevo = await bajarPromos();
    let viejo = { promos: [] };
    try { viejo = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    for (const s of Object.keys(nuevo.errors)) {
      nuevo.promos.push(...viejo.promos.filter(p => p.super === s && (!p.hasta || p.hasta >= hoy)));
      meta.errors["promos-" + s] = nuevo.errors[s];
    }
    if (nuevo.promos.length) fs.writeFileSync(f, JSON.stringify(nuevo));
    meta.ok.promos = nuevo.promos.length;
  } catch (e) {
    meta.errors.promos = e.message;
    console.error(`promos: ERROR ${e.message}`);
  }
  if (GUARDAR_HISTORIAL) {
    try { guardarHistorial(out, porCat, new Date(meta.updated)); }
    catch (e) { meta.errors.historial = e.message; console.error(`historial: ERROR ${e.message}`); }
  }
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
  if (!Object.keys(meta.ok).length) process.exit(1);
})();
