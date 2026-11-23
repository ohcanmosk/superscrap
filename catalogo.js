// SuperScrap - catálogo completo de supermercado de Coto, Dia y Carrefour, en formato compacto.
// Lo usan la búsqueda libre (en la web, donde Dia y Carrefour no se pueden consultar en vivo) y las listas de compras.
// GitHub Actions lo corre después de scrape.js y lo sube a la rama "catalogo" (pisándola, sin historial);
// la app lo lee de raw.githubusercontent.com (CATALOGO_URL en categorias.js).
//
// Uso: node catalogo.js [carpeta]   (por defecto ./catalogo). Si un súper falla, se deja su archivo anterior.
//
// Formato de <súper>.json: { v, store, updated, cols, items: [[id, sku, nombre, marca, precio, lista, promos, categoría, url]] }
//   promos = [[unidades, precio c/u, texto]], url = linkText (Dia/Carrefour) o ruta del producto (Coto).

const fs = require("fs");
const path = require("path");
const { vtexOffer, cotoOffer } = require("./comun.js");

const OUT = process.argv[2] || path.join(__dirname, "catalogo");
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", accept: "application/json" };
const COLS = ["id", "sku", "name", "brand", "shelf", "list", "promos", "cat", "url"];
const r2 = n => Math.round(n * 100) / 100;

// Categorías de supermercado (sin electro, ropa, hogar, etc.).
const SUPER = {
  dia: { host: "https://diaonline.supermercadosdia.com.ar", rx: /almac|beb[eé]s|mascotas|desayuno|frescos|bebidas|congelados|perfumer|limpieza|carnicer|frutas/i },
  carrefour: { host: "https://www.carrefour.com.ar", rx: /^(almac|desayuno|bebidas|l[aá]cteos|carnes|frutas|panader|congelados|limpieza|perfumer|mundo beb|mascotas)/i },
  coto: { rx: /^(almac|bebidas|frescos|congelados|limpieza|perfumer)/i },
};

async function getJSON(url, intentos = 4) {
  for (let i = 0; ; i++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(url, { headers: UA, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { fatal: true });
      return await r.json();
    } catch (e) {
      if (e.fatal || i >= intentos - 1) throw e;
      await new Promise(res => setTimeout(res, 1500 * (i + 1) ** 2));
    }
  }
}
// Corre las tareas de a "n" a la vez.
async function enParalelo(tareas, n) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tareas.length) { const k = i++; out[k] = await tareas[k](); } }));
  return out;
}
const promosCompactas = promos => promos.map(x => [x.qty, r2(x.unit), x.text]);

// ---------- Dia y Carrefour (VTEX): por categoría hoja, de a 50 (máx. 2500 por categoría) ----------
async function catalogoVtex(store) {
  const { host, rx } = SUPER[store];
  const tree = await getJSON(`${host}/api/catalog_system/pub/category/tree/3`);
  const hojas = [];
  (function w(cs, ids) {
    for (const c of cs) { const p = [...ids, c.id]; if (c.children?.length) w(c.children, p); else hojas.push(p); }
  })(tree.filter(c => rx.test(c.name)), []);
  const prods = new Map();
  await enParalelo(hojas.map(ids => async () => {
    for (let from = 0; from < 2500; from += 50) {
      const j = await getJSON(`${host}/api/catalog_system/pub/products/search?fq=C:/${ids.join("/")}/&_from=${from}&_to=${from + 49}`);
      for (const p of j) {
        if (prods.has(p.productId)) continue;
        const o = vtexOffer(p, store); if (!o) continue; // sin precio o sin stock online
        prods.set(p.productId, [p.productId, p.items?.[0]?.itemId || null, p.productName.trim(), (p.brand || "").trim().toUpperCase(),
          r2(o.shelf), r2(o.list), promosCompactas(o.promos), p.categories?.[0] || "", p.linkText || ""]);
      }
      if (j.length < 50) break;
    }
  }), 6);
  return [...prods.values()];
}

// ---------- Coto (Endeca): por categoría, de a 1000 ----------
const cotoRecords = j => { let r = null; (function w(o) { if (r) return; if (Array.isArray(o)) o.forEach(w); else if (o && typeof o === "object") { if (o.records && o["@type"] && Array.isArray(o.records)) { r = o.records; return; } for (const k in o) w(o[k]); } })(j); return r || []; };
async function catalogoCoto() {
  const base = "https://www.coto.com.ar/sitios/cdigi/categoria";
  const raiz = await getJSON(`${base}?format=json&Nrpp=1`);
  const cats = [];
  (function w(o) {
    if (Array.isArray(o)) o.forEach(w);
    else if (o && typeof o === "object") {
      if (o.label && o.count != null && typeof o.navigationState === "string" && SUPER.coto.rx.test(o.label) && /^\/catalogo-/.test(o.navigationState)
          && !cats.some(c => c.label === o.label)) cats.push({ label: o.label, count: o.count, ruta: o.navigationState.split("?")[0] });
      for (const k in o) w(o[k]);
    }
  })(raiz);
  if (!cats.length) throw new Error("no se encontraron categorías");
  const prods = new Map();
  for (const c of cats) {
    for (let no = 0; no < c.count + 1000; no += 1000) {
      const recs = cotoRecords(await getJSON(`${base}${encodeURI(decodeURI(c.ruta))}?Nrpp=1000&No=${no}&format=json`));
      for (const r of recs) {
        const a = r.records?.[0]?.attributes || {}; const g = k => (a[k] || [])[0];
        const id = g("sku.repositoryId"), name = (g("sku.displayName") || g("product.displayName") || "").trim();
        if (!id || !name || prods.has(id)) continue;
        const o = cotoOffer(a); if (!o) continue;
        prods.set(id, [id, null, name, (g("product.brand") || "").trim().toUpperCase(), r2(o.shelf), r2(o.list), promosCompactas(o.promos),
          g("product.category") || c.label, (r.detailsAction?.recordState || "").replace(/\?.*$/, "")]);
      }
      if (recs.length < 1000) break;
    }
  }
  return [...prods.values()];
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const meta = { updated: new Date().toISOString(), counts: {}, errors: {} };
  try { Object.assign(meta.counts, JSON.parse(fs.readFileSync(path.join(OUT, "meta.json"), "utf8")).counts); } catch {}
  for (const [store, fn] of [["dia", () => catalogoVtex("dia")], ["coto", catalogoCoto], ["carrefour", () => catalogoVtex("carrefour")]]) {
    const t = Date.now();
    try {
      const items = await fn();
      if (items.length < 500) throw new Error(`muy pocos productos (${items.length})`);
      fs.writeFileSync(path.join(OUT, store + ".json"), JSON.stringify({ v: 1, store, updated: meta.updated, cols: COLS, items }));
      meta.counts[store] = items.length;
      console.log(`catálogo ${store}: ${items.length} productos en ${((Date.now() - t) / 1000).toFixed(0)} s`);
    } catch (e) {
      meta.errors[store] = e.message;
      console.error(`catálogo ${store}: ERROR ${e.message} (queda el archivo anterior)`);
    }
  }
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta));
  if (Object.keys(meta.errors).length === 3) process.exit(1);
})();
