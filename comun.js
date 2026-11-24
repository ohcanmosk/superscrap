// SuperScrap - funciones compartidas entre index.html, historico.html y scrape.js:
// leer tamaños, promos y precios de Dia/Carrefour (VTEX) y Coto, y filtrar por categoría.
// Así el histórico que guarda scrape.js calcula los precios igual que la app.

(function (root) {
  const numAR = s => parseFloat(String(s).replace(/\./g, "").replace(",", "."));
  const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Tamaño del envase a partir del nombre: { size, unit } en kg o L, o null si no se puede saber.
  // Entiende "250 Gr.", "1,1 Kg.", "1k", "500 ml", "1 Lt." y packs "3 x 170 g".
  function parseSize(name) {
    const n = norm(name);
    const m = n.match(/(\d+(?:[.,]\d+)?)\s*(kgm|kgs?|kilos?|k|grm|grs?|gramos?|g|ml|cc|ltr|lts?|litros?|l)(?![a-z])/);
    // Productos que se venden por kilo sin decir el peso ("Bola de lomo X KG", "x Kg.", "por kilo"): el precio es por 1 kg.
    if (!m) return /(^|[^a-z0-9])(x|por)\s*(kgs?|kilos?)(?![a-z])/.test(n) ? { size: 1, unit: "kg" } : null;
    let v = parseFloat(m[1].replace(",", "."));
    if (!v) return null;
    const u = m[2];
    const weight = /^(k|g)/.test(u);
    if (/^(g|ml|cc)/.test(u)) v /= 1000;
    const pack = n.slice(0, m.index + m[0].length).match(/(\d+)\s*x\s*\d+(?:[.,]\d+)?\s*[a-z]+$/);
    if (pack) v *= +pack[1];
    return { size: v, unit: weight ? "kg" : "L" };
  }

  // Papel higiénico: metros totales del paquete = metros por rollo × rollos.
  // Entiende "30 mts 4 Ud.", "4 x 30 mts", "x12 30 mts", "4 u. x 20 m.", "4 rollos de 30m", "30 M 4 Un", "x 120 mts".
  // Coto a veces pone el área del paquete ("Paq 12 M2"): con rollos de 10 cm de ancho, 12 m² = 120 m.
  // Devuelve { total, detalle } (detalle = la cuenta para mostrar: "4 rollos × 30 m = 120 m"), o null.
  const fmtM = v => String(Math.round(v * 10) / 10).replace(".", ",");
  function parseMetrosDetalle(name) {
    const area = norm(name).match(/(?:paq|bol)\.?\s*(\d+(?:[.,]\d+)?)\s*m2\b/);
    if (area) {
      const m2 = parseFloat(area[1].replace(",", "."));
      return { total: m2 * 10, detalle: `${fmtM(m2)} m² ≈ ${fmtM(m2 * 10)} m (rollos de 10 cm)` };
    }
    const n = norm(name).replace(/\bm2\b/g, " ");
    const m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:metros?|mtrs?|mts?|m)(?![a-z0-9])\.?/);
    if (!m) return null;
    const metros = parseFloat(m[1].replace(",", "."));
    if (!metros) return null;
    const resto = n.slice(0, m.index) + " " + n.slice(m.index + m[0].length);
    const r = resto.match(/(\d+)\s*(?:u\b|u\.|un\b|uni\b|unid\w*|ud\b|ud\.|rollos?)/) ||
              resto.match(/\bx\s*(\d+)\b/) || resto.match(/\b(\d+)\s*x\b/);
    const rollos = r ? +r[1] : 1;
    return { total: metros * rollos, detalle: `${rollos} rollo${rollos === 1 ? "" : "s"} × ${fmtM(metros)} m = ${fmtM(metros * rollos)} m` };
  }
  const parseMetros = name => parseMetrosDetalle(name)?.total ?? null;
  // Tamaño según la categoría: c.medida = "metros" (papel), c.porDefecto (leches: 1 L si no lo dice).
  function tamano(name, c) {
    if (c && c.medida === "metros") { const m = parseMetrosDetalle(name); return m ? { size: m.total, unit: "m", detalle: m.detalle } : null; }
    const s = parseSize(name);
    if (c && c.porDefecto) return { size: s && s.unit === c.unit ? s.size : c.porDefecto, unit: c.unit };
    return s;
  }

  // Promos de Dia/Carrefour: "Llevando 2 a $X c/u", "3x2", "2do al 70%", "20%".
  function parseDiaTeaser(name, price) {
    const t = name.trim(); let m;
    if ((m = t.match(/llevando\s*(\d+)\s*a\s*\$\s*([\d.,]+)/i))) return { qty: +m[1], unit: numAR(m[2]), text: t };
    if ((m = t.match(/(\d)\s*x\s*(\d)/i))) { const a = +m[1], b = +m[2]; return { qty: a, unit: price * b / a, text: t }; }
    if ((m = t.match(/(\d)\s*(?:do|da|°|º)?\s*(?:unidad|u\.?)?\s*al\s*(\d+)\s*%/i))) {
      const q = +m[1], p = +m[2]; return { qty: q, unit: price * (q - p / 100) / q, text: t };
    }
    if ((m = t.match(/(\d+)\s*%/))) return { qty: 1, unit: price * (1 - m[1] / 100), text: t };
    return null;
  }
  // Carrefour: "PROMO-2do al 50% Max 8 unidades Combinable CABRALES-Reg-2-50-Ahorro18 al 24/11" → "2do al 50%".
  // Se ignoran las promos con Tarjeta / Cuenta Digital Carrefour (no las tiene cualquiera).
  function cleanCarrefourTeaser(t) {
    if (/tarjeta|cuenta digital|mi carrefour|credito|debito/i.test(t)) return null;
    return t.replace(/^PROMO-/i, "").replace(/\s*(Max|Combinable|Iguales|-Reg-).*$/i, "").trim() || null;
  }

  // Precio y promos de un producto VTEX (Dia / Carrefour). null si no está disponible.
  function vtexOffer(p, storeId) {
    const o = p.items?.[0]?.sellers?.[0]?.commertialOffer;
    if (!o || !o.Price || !o.IsAvailable) return null;
    const teasers = (o.Teasers || []).map(t => t["<Name>k__BackingField"] || t.Name || "")
      .map(t => storeId === "carrefour" ? cleanCarrefourTeaser(t) : t).filter(Boolean);
    const promos = teasers.map(t => parseDiaTeaser(t, o.Price)).filter(x => x && x.unit > 0 && x.unit < o.Price);
    return { shelf: o.Price, list: Math.max(o.ListPrice || 0, o.Price), promos };
  }
  // Precio y promos de un producto de Coto (atributos Endeca). null si no tiene precio.
  function cotoOffer(a) {
    const g = k => (a[k] || [])[0];
    const shelf = parseFloat(g("sku.activePrice"));
    if (!shelf) return null;
    let promos = [];
    try {
      promos = JSON.parse(g("product.dtoDescuentos") || "[]").map(d => {
        const unit = parseFloat(d.precioDesc);
        const q = (String(d.textoLlevando || "").match(/(\d+)/) || [])[1];
        // "+10%" con imagen comunidad.png = descuento adicional solo para socios de Comunidad Coto.
        const comunidad = /comunidad/i.test(d.imagenDescuento || "");
        return { qty: q ? +q : 1, unit, text: (d.textoDescuento || "").trim() + (q ? " llevando " + q : "") + (comunidad ? " Comunidad Coto" : ""),
          ...(comunidad ? { comunidad: true } : {}) };
      }).filter(x => x.unit > 0 && x.unit < shelf);
    } catch {}
    let list = shelf;
    try { const dp = JSON.parse(g("sku.dtoPrice") || "{}"); if (dp.precioLista > shelf) list = dp.precioLista; } catch {}
    // Precio por unidad de medida que publica Coto (en papel higiénico: por m²).
    const ref = parseFloat(g("sku.referencePrice")) || null;
    return { shelf, list, promos, ref };
  }
  // Tamaño de un producto de Coto: en papel higiénico se usa su precio por m² (precio ÷ precio por m² = m²;
  // rollos de 10 cm de ancho → m² × 10 = metros), que está aunque el nombre no diga los metros.
  function tamanoCoto(name, c, o) {
    if (c && c.medida === "metros" && o && o.ref) {
      const m2 = o.shelf / o.ref, total = Math.round(m2 * 10), del = parseMetrosDetalle(name);
      // Si el nombre trae rollos × metros y coincide, se muestra esa cuenta; si no, la de Coto por m².
      return { size: total, unit: "m", detalle: del && Math.abs(del.total - total) < 1 && !/m²/.test(del.detalle) ? del.detalle
        : `${fmtM(m2)} m² según Coto ≈ ${fmtM(total)} m (rollos de 10 cm)` };
    }
    return tamano(name, c);
  }

  // ¿El producto ({ name, brand }) entra en la categoría (include / exclude / brand)?
  function matchesCat(p, c) {
    const n = norm(p.name);
    if ((c.include || []).some(rx => !rx.test(n))) return false;
    if (c.exclude && c.exclude.test(n)) return false;
    if (c.brand && !c.brand.test(norm(p.brand)) && !c.brand.test(n)) return false;
    return true;
  }

  // ---------- Medios de pago (descuentos bancarios / billeteras) ----------
  // tipo: billetera | banco | beneficio (programas: ANSES, jubilados...) | tarjeta (último recurso).
  // logo: archivo en logos/<logo>.png (si no hay, la app muestra el nombre). rx: se busca en el texto normalizado.
  const MEDIOS = {
    mercadopago:  { label: "Mercado Pago", tipo: "billetera", logo: "mercadopago", rx: /mercado ?pago/ },
    modo:         { label: "MODO", tipo: "billetera", logo: "modo", rx: /\bmodo\b/ },
    cuentadni:    { label: "Cuenta DNI", tipo: "billetera", logo: "cuentadni", rx: /cuenta ?dni|clave dni/ },
    personalpay:  { label: "Personal Pay", tipo: "billetera", logo: "personalpay", rx: /personal ?pay/ },
    naranjax:     { label: "Naranja X", tipo: "billetera", logo: "naranjax", rx: /naranja/ },
    uala:         { label: "Ualá", tipo: "billetera", rx: /\buala\b/ },
    prex:         { label: "Prex", tipo: "billetera", rx: /\bprex\b/ },
    carrefourbanco: { label: "Carrefour Banco", tipo: "billetera", rx: /carrefour banco|cuenta digital|tarjeta de credito (de )?carrefour|carrefour-?credito/ },
    galicia:      { label: "Galicia", tipo: "banco", logo: "galicia", rx: /galicia/ },
    santander:    { label: "Santander", tipo: "banco", rx: /santander/ },
    bbva:         { label: "BBVA", tipo: "banco", rx: /bbva|\bfrances\b/ },
    macro:        { label: "Macro", tipo: "banco", logo: "macro", rx: /\bmacro\b/ },
    nacion:       { label: "Banco Nación", tipo: "banco", logo: "nacion", rx: /banco (de la )?nacion|\bbna\b|logo nacion/ },
    provincia:    { label: "Banco Provincia", tipo: "banco", rx: /banco (de la )?provincia|bco-provincia/ },
    ciudad:       { label: "Banco Ciudad", tipo: "banco", logo: "ciudad", rx: /banco (de la )?ciudad|app de ciudad|logo ciudad\d/ },
    patagonia:    { label: "Patagonia", tipo: "banco", logo: "patagonia", rx: /patagonia/ },
    icbc:         { label: "ICBC", tipo: "banco", logo: "icbc", rx: /\bicbc\b/ },
    supervielle:  { label: "Supervielle", tipo: "banco", logo: "supervielle", rx: /supervielle|superville/ },
    comafi:       { label: "Comafi", tipo: "banco", logo: "comafi", rx: /comafi/ },
    columbia:     { label: "Columbia", tipo: "banco", logo: "columbia", rx: /columbia/ },
    credicoop:    { label: "Credicoop", tipo: "banco", logo: "credicoop", rx: /credicoop/ },
    hipotecario:  { label: "Hipotecario", tipo: "banco", logo: "hipotecario", rx: /hipotecario/ },
    itau:         { label: "Itaú", tipo: "banco", rx: /\bitau\b/ },
    hsbc:         { label: "HSBC", tipo: "banco", rx: /\bhsbc\b/ },
    tci:          { label: "TCI", tipo: "banco", logo: "tci", rx: /\btci\b/ },
    sidecreer:    { label: "Sidecreer", tipo: "banco", rx: /sidecreer/ },
    bancodelsol:  { label: "Banco del Sol", tipo: "banco", rx: /banco del sol|\bbds\b/ },
    corrientes:   { label: "Banco de Corrientes", tipo: "banco", rx: /banco (de )?corrientes/ },
    entrerios:    { label: "Banco Entre Ríos", tipo: "banco", rx: /banco (de )?entre rios/ },
    bancor:       { label: "Bancor", tipo: "banco", rx: /bancor\b/ },
    anses:        { label: "ANSES", tipo: "beneficio", logo: "anses", rx: /anses/ },
    jubilados:    { label: "Jubilados", tipo: "beneficio", logo: "jubilados", rx: /jubilad/ },
    ciudadania:   { label: "Ciudadanía Porteña", tipo: "beneficio", logo: "ciudadania", rx: /ciudadania porten/ },
    empleados:    { label: "Empleados públicos", tipo: "beneficio", rx: /emplead[oa](\/a)? public/ },
    clublanacion: { label: "Club La Nación", tipo: "beneficio", rx: /club ?(la ?)?nacion/ },
    comunidad:    { label: "Comunidad Coto", tipo: "beneficio", rx: /comunidad/ },
    // Cupón Club Dia de los martes (socios).
    clubdia:      { label: "Club Dia", tipo: "beneficio", rx: /club ?dia/ },
    // Varias marcas juntas ("Visa, Mastercard, Amex y Cabal") = cualquier tarjeta de crédito.
    tarjetas:     { label: "Tarjetas de crédito", tipo: "tarjeta", rx: /(visa|mastercard|american express|amex|cabal)\b.*(?!\1)(visa|mastercard|american express|amex|cabal)\b/ },
    amex:         { label: "American Express", tipo: "tarjeta", logo: "amex", rx: /american express|\bamex/ },
    visa:         { label: "Visa", tipo: "tarjeta", logo: "visa", rx: /\bvisa/ },
    todos:        { label: "Cualquier medio de pago", tipo: "todos", rx: /todos los medios de pago/ },
  };
  // Qué medio pide una promo según uno o más textos, en orden de importancia (título/descripción primero,
  // después el logo o el banco asociado). Prioridad: billetera > banco > beneficio > "todos los medios" > tarjeta.
  // "Pagando con MODO desde la app de Ciudad" → { medio: "modo", banco: "ciudad" } (hace falta tener los dos).
  function clasificarMedio(...textos) {
    const ns = textos.filter(Boolean).map(t => norm(t).replace(/[_.-]+/g, " "));
    const de = tipo => {
      for (const n of ns) { const k = Object.keys(MEDIOS).find(k => MEDIOS[k].tipo === tipo && MEDIOS[k].rx.test(n)); if (k) return k; }
      return null;
    };
    const billetera = de("billetera"), banco = de("banco");
    if (billetera) return { medio: billetera, banco: billetera === "modo" ? banco : null };
    return { medio: banco || de("beneficio") || de("todos") || de("tarjeta"), banco: null };
  }

  // Promos que puede usar el usuario: las de Comunidad Coto solo si es socio (medio "comunidad").
  const esComunidad = x => x.comunidad || /comunidad coto/i.test(x.text || "");
  const promosUsables = (promos, medios) => (promos || []).filter(x => !esComunidad(x) || (medios && medios.comunidad));

  const api = { esComunidad, promosUsables, numAR, norm, parseSize, parseMetros, parseMetrosDetalle, tamano, tamanoCoto, parseDiaTeaser, cleanCarrefourTeaser, vtexOffer, cotoOffer, matchesCat, MEDIOS, clasificarMedio };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SuperScrapComun = api;
})(this);
