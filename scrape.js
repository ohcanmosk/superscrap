// SuperScrap - descarga una "foto" de los precios de Dia y Coto a data/*.json
// La usa GitHub Actions todos los días, así la versión web (GitHub Pages) tiene
// datos de Dia aunque el navegador del celular no pueda consultarlo directo.
// Uso: node scrape.js

const fs = require("fs");
const path = require("path");

const DIA_BASE = "https://diaonline.supermercadosdia.com.ar";
// Mantener sincronizado con SOURCES en index.html (la clave = nombre del archivo).
const SOURCES = {
  "dia-enteras": DIA_BASE + "/api/catalog_system/pub/products/search/frescos/leches/leches-enteras?map=c,c,c&_from=0&_to=49&O=OrderByPriceASC",
  "dia-descremadas": DIA_BASE + "/api/catalog_system/pub/products/search/frescos/leches/leches-descremadas?map=c,c,c&_from=0&_to=49&O=OrderByPriceASC",
  "coto": "https://www.coto.com.ar/sitios/cdigi/categoria/catalogo-frescos-l%C3%A1cteos-leches/_/N-zpvqr7?Nrpp=300&format=json",
};

// Coto devuelve ~1 MB; nos quedamos solo con los campos que usa la app.
const COTO_KEEP = ["sku.displayName", "product.displayName", "product.category", "sku.activePrice",
  "product.dtoDescuentos", "sku.dtoPrice", "sku.repositoryId", "product.brand",
  "product.mediumImage.url", "product.LCLASE"];
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
    records: recs.map(r => ({
      detailsAction: { recordState: r.detailsAction?.recordState || "" },
      records: [{ attributes: Object.fromEntries(COTO_KEEP.filter(k => r.records?.[0]?.attributes?.[k])
        .map(k => [k, r.records[0].attributes[k]])) }],
    })),
  };
}

function trimDia(list) {
  return list.map(p => {
    const it = p.items?.[0] || {}; const o = it.sellers?.[0]?.commertialOffer || {};
    return {
      productId: p.productId, productName: p.productName, brand: p.brand, link: p.link, categories: p.categories,
      items: [{ images: (it.images || []).slice(0, 1).map(i => ({ imageUrl: i.imageUrl })),
        sellers: [{ commertialOffer: { Price: o.Price, ListPrice: o.ListPrice, IsAvailable: o.IsAvailable,
          Teasers: (o.Teasers || []).map(t => ({ Name: t["<Name>k__BackingField"] || t.Name })) } }] }],
    };
  });
}

(async () => {
  const out = path.join(__dirname, "data");
  fs.mkdirSync(out, { recursive: true });
  const meta = { updated: new Date().toISOString(), ok: {}, errors: {} };
  for (const [key, url] of Object.entries(SOURCES)) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (SuperScrap)", accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      let j = await r.json();
      j = key === "coto" ? trimCoto(j) : trimDia(j);
      const n = Array.isArray(j) ? j.length : j.records.length;
      if (!n) throw new Error("respuesta vacía");
      fs.writeFileSync(path.join(out, key + ".json"), JSON.stringify(j));
      meta.ok[key] = n;
      console.log(`${key}: ${n} productos`);
    } catch (e) {
      meta.errors[key] = e.message;
      console.error(`${key}: ERROR ${e.message}`);
    }
  }
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
  if (!Object.keys(meta.ok).length) process.exit(1);
})();
