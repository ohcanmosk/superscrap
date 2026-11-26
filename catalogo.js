// SuperScrap - catálogo completo de supermercado de Coto, Dia y Carrefour, en formato compacto.
// Lo usan la búsqueda libre (en la web, donde Dia y Carrefour no se pueden consultar en vivo) y las listas de compras.
// GitHub Actions lo corre 1 vez por día (corrida de las 7:17) y lo sube a la rama "catalogo" (pisándola, sin historial);
// la app lo lee de raw.githubusercontent.com (CATALOGO_URL en categorias.js).
//
// Uso: node catalogo.js [carpeta]   (por defecto ./catalogo). Si un súper falla, se deja su archivo anterior.
//
// Formato de <súper>.json: { v, store, updated, cols, items: [[id, sku, nombre, marca, precio, lista, promos, categoría, url]] }
//   promos = [[unidades, precio c/u, texto]], url = linkText (Dia/Carrefour) o ruta del producto (Coto).
//
// Histórico (para el histórico de las listas de compras): historial/<súper>.json, los últimos HIST_DIAS (30) días, solo los cambios.
//   { v, store, dias: [día, ...], p: { "<id>": [[día, precio, unidades, c/u, unidades, c/u...], [día] ...] } }
//   día = número de día (días desde 1/1/1970, fecha de Argentina); [día] solo = ese día no estaba en el catálogo.
//   Las promos son las del producto (sin las de Comunidad Coto, que son solo para socios). Cada entrada vale desde
//   ese día hasta la siguiente; se guarda la última de antes del período para saber el precio del primer día.

const fs = require("fs");
const path = require("path");
const { vtexOffer, cotoOffer, esComunidad } = require("./comun.js");

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

// Para no cargar a los súper: pocos pedidos a la vez (PARALELO), una pausa después de cada uno (PAUSA_MS)
// y, si responden "demasiados pedidos" (429) o fallan, se espera bastante antes de reintentar.
const PARALELO = 3, PAUSA_MS = 300;
const dormir = ms => new Promise(res => setTimeout(res, ms));
async function getJSON(url, intentos = 4) {
  for (let i = 0; ; i++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(url, { headers: UA, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error("HTTP " + r.status), { status: r.status });
      if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { fatal: true });
      const j = await r.json();
      await dormir(PAUSA_MS);
      return j;
    } catch (e) {
      if (e.fatal || i >= intentos - 1) throw e;
      await dormir((e.status === 429 ? 15000 : 3000) * (i + 1));
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
  }), PARALELO);
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

// ---------- Histórico ----------
const HIST_DIAS = 30;
const diaNum = (t = new Date()) => { const d = new Date(t.getTime() - 3 * 3600e3); return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 864e5); };
const igual = (a, b) => a.length === b.length && a.every((x, i) => i === 0 || x === b[i]);
function actualizarHistorial(store, items, hoy) {
  const f = path.join(OUT, "historial", store + ".json");
  let h = null; try { h = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  if (!h || h.v !== 1) h = { v: 1, store, dias: [], p: {} };
  const vistos = new Set();
  const poner = (id, e) => {
    const a = (h.p[id] ||= []), ult = a[a.length - 1];
    if (ult && ult[0] === hoy) a.pop();               // otra corrida el mismo día: vale la última
    const prev = a[a.length - 1];
    if (!prev || !igual(prev, e)) a.push(e);
  };
  for (const r of items) {
    const id = String(r[0]); vistos.add(id);
    const promos = (r[6] || []).filter(([, , text]) => !esComunidad({ text })).flatMap(([q, u]) => [q, u]);
    poner(id, [hoy, r[4], ...promos]);
  }
  // Los que ya no están en el catálogo: [día] (sin precio), si antes tenían.
  for (const [id, a] of Object.entries(h.p)) if (!vistos.has(id) && a[a.length - 1].length > 1) poner(id, [hoy]);
  // Recortar: solo los últimos HIST_DIAS días, más la última entrada de antes (el precio con que arranca el período).
  const desde = hoy - HIST_DIAS + 1;
  h.dias = [...new Set([...h.dias, hoy])].filter(d => d >= desde).sort((a, b) => a - b);
  for (const [id, a] of Object.entries(h.p)) {
    const i = a.findIndex(e => e[0] >= desde);
    const resto = i < 0 ? a.slice(-1) : i > 0 ? a.slice(i - 1) : a;
    if (resto.length === 1 && resto[0].length === 1 && resto[0][0] < desde) delete h.p[id]; // no está hace rato
    else h.p[id] = resto;
  }
  h.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(h));
  return Object.keys(h.p).length;
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
      try { actualizarHistorial(store, items, diaNum()); } catch (e) { console.error(`historial ${store}: ERROR ${e.message}`); }
      console.log(`catálogo ${store}: ${items.length} productos en ${((Date.now() - t) / 1000).toFixed(0)} s`);
    } catch (e) {
      meta.errors[store] = e.message;
      console.error(`catálogo ${store}: ERROR ${e.message} (queda el archivo anterior)`);
    }
  }
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta));
  if (Object.keys(meta.errors).length === 3) process.exit(1);
})();
