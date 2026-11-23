// SuperScrap - descuentos con billeteras y bancos (Mercado Pago, MODO, Cuenta DNI, bancos...)
// que publican Coto, Dia y Carrefour en sus webs. Los baja y los deja todos con el mismo formato
// en data/promos.json, que muestra la pestaña "💳 Descuentos" y usa el ranking de precios.
// Lo llama scrape.js; también se puede correr solo: node promos.js
//
// Fuentes (ninguna es una API oficial; si un súper cambia su web, puede dejar de andar):
// - Coto: el servicio que usa coto.com.ar/descuentos (JSON, permite CORS).
// - Dia: la página "medios de pago y promociones" trae las tarjetas de promos como JSON dentro del HTML.
// - Carrefour: Master Data pública de VTEX (entidad BP = promos bancarias, FB = bancos).

const { norm, clasificarMedio } = require("./comun.js");

const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" };
const URLS = {
  coto: "https://www.coto.com.ar/rest/model/atg/actors/cProfileActor/getPromocionesMulticanal",
  cotoLegal: "https://www.coto.com.ar/terminos-descuentos",
  dia: "https://diaonline.supermercadosdia.com.ar/medios-de-pago-y-promociones",
  carrefour: "https://www.carrefour.com.ar/api/dataentities/BP/search",
  carrefourBancos: "https://www.carrefour.com.ar/api/dataentities/FB/search?_fields=id,name",
  carrefourLegal: "https://www.carrefour.com.ar/descuentos-bancarios",
};
const TZ = "America/Argentina/Buenos_Aires";
const hoyAR = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pesos = s => +String(s).replace(/[.\s]/g, "").replace(/,\d*$/, "");
const fmtPesos = n => "$" + n.toLocaleString("es-AR");
const iso = (d, m, y) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// ---------- Lectura de condiciones (texto libre) ----------
// Tope de reintegro: "Sin tope" / "Tope $10.000 por mes". Topes gigantes (Dia + MP: $1.999.999) = sin tope.
function parseTope(texto) {
  const n = norm(texto);
  const U = "(?:semana|mes|transaccion|cuenta|cliente|dia|banco|usuario|compra|tarjeta|persona)";
  const m = n.match(new RegExp(`(?:tope|limite)(?: (?:de |del )?(?:reintegro|devolucion|descuento|beneficio))*(?: es)?:?\\s*(?:de\\s*)?(?:hasta\\s*)?\\$\\s*([\\d.,]+)\\s*((?:por|x) ${U}(?:,? (?:y )?(?:por )?${U})?)?`));
  if (m) {
    const v = pesos(m[1]);
    if (v >= 500000) return "Sin tope";
    const por = (m[2] || "").replace(/^x /, "por ").replace(/transaccion/g, "transacción").replace(/\bdia\b/g, "día");
    return `Tope ${fmtPesos(v)}${por ? " " + por : ""}`;
  }
  if (/sin tope/.test(n)) return "Sin tope";
  return null;
}
// Compra mínima en pesos (null si no dice).
function parseMinimo(texto) {
  const n = norm(texto);
  const m = n.match(/(?:minimo de compra|compra minima|pago minimo|compras? (?:mayores (?:o iguales )?a|a partir de|superiores a)|minimo)(?: de)?:?\s*\$\s*([\d.,]+)/);
  const v = m ? pesos(m[1]) : null;
  return v && v > 1 ? v : null;
}
// Porcentaje de descuento o reintegro.
function parsePct(texto) {
  const n = norm(texto);
  const m = n.match(/consiste en (?:un )?(\d{1,2}) ?%/) || n.match(/(\d{1,2}) ?% (?:\([^)]*\) )?(?:de )?(?:descuento|reintegro|ahorro|bonificacion|off)/) ||
            n.match(/(?:bonificacion|reintegro|descuento) del (\d{1,2}) ?%/) || n.match(/(\d{1,2}) ?%/);
  return m ? +m[1] : null;
}
const parseCuotas = texto => { const m = norm(texto).match(/(\d{1,2}) cuotas sin interes/); return m ? +m[1] : null; };
// Fechas de vigencia que aparecen en las condiciones: { desde, hasta } (YYYY-MM-DD) o null.
function parseVigencia(texto) {
  const n = norm(texto), fechas = [];
  for (const m of n.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) fechas.push(iso(+m[1], +m[2], +m[3]));
  const mes = MESES.join("|");
  for (const m of n.matchAll(new RegExp(`\\b(\\d{1,2}) de (${mes}) de(?:l)? (\\d{4})`, "g"))) fechas.push(iso(+m[1], MESES.indexOf(m[2]) + 1, +m[3]));
  // "los martes del mes de noviembre de 2026", "los lunes de mayo del 2026": todo ese mes.
  if (!fechas.length) for (const m of n.matchAll(new RegExp(`(?:mes de |de )(${mes}) de(?:l)? (\\d{4})`, "g"))) {
    const mm = MESES.indexOf(m[1]) + 1, y = +m[2];
    fechas.push(iso(1, mm, y), iso(new Date(Date.UTC(y, mm, 0)).getUTCDate(), mm, y));
  }
  if (!fechas.length) return null;
  fechas.sort();
  if (fechas.length === 1) return { desde: null, hasta: fechas[0] };
  return { desde: fechas[0], hasta: fechas[fechas.length - 1] };
}
const acumulable = texto => { const n = norm(texto); return /no (es )?acumulable|no acumula/.test(n) ? false : /acumulable/.test(n) ? true : null; };
const recortar = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, "") + "…" : s; };

// ---------- Coto ----------
async function promosCoto() {
  const r = await fetch(URLS.coto, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const res = j.result || {};
  const out = [];
  for (const [lista, local] of [["promocionesSucursalesFisicas", true], ["promocionesDigitales", false]]) {
    for (const p of res[lista] || []) {
      const desc = (p.descripcion || "").replace(/^exclusivo en sucursales\.\s*/i, "").trim();
      const obs = p.observacion || "", texto = `${desc} ${obs}`;
      const icono = p.icono || "";
      const dias = (p.dias || []).map(d => d.id - 1).filter(d => d >= 0 && d <= 6);
      const vig = parseVigencia(obs);
      out.push({
        id: "coto:" + p.id, super: "coto", ...clasificarMedio(desc, icono),
        pct: /cuotas/i.test(p.textoDescuento) ? null : parsePct(p.textoDescuento), cuotas: parseCuotas(p.textoDescuento),
        dias: dias.length ? dias : [0, 1, 2, 3, 4, 5, 6], local, online: !local, tiendas: local ? "Sucursales Coto" : "Coto Digital (online)",
        tope: parseTope(obs), minimo: parseMinimo(texto),
        desde: vig?.desde || null, hasta: vig?.hasta || null, cuando: p.diasVigencia || null,
        soloSinOferta: /sin oferta/i.test(texto), acumulable: acumulable(texto),
        resumen: recortar(desc, 220), legal: recortar(obs, 1500), url: URLS.cotoLegal,
      });
    }
  }
  return out;
}

// ---------- Dia ----------
// En el HTML hay más de un bloque de "cards" (uno viejo que queda en la página); se usa el último,
// que es el de la página de promos, y además se descartan las que tienen fechas vencidas.
async function promosDia() {
  const r = await fetch(URLS.dia, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const html = await r.text();
  const starts = [...html.matchAll(/"cards":\[/g)].map(m => m.index + 8);
  if (!starts.length) throw new Error("no se encontraron promos en la página");
  let cards = [];
  for (let i = starts.length - 1; i >= 0 && !cards.length; i--) {
    try { cards = parseJSONAt(html, starts[i]).filter(c => c && c.daysToShow); } catch {}
  }
  const DIAS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return cards.filter(c => c.active).map((c, i) => {
    const titulo = (c.__editorItemTitle || "").trim(), terms = c.terms || "";
    const vig = parseVigencia(terms);
    const cuotasTit = titulo.match(/(\d+)\s*CS?I\b/i), pctTit = titulo.match(/(\d{1,2})\s*%/);
    return {
      id: "dia:" + i, super: "dia", ...clasificarMedio(titulo, terms.slice(0, 700)),
      pct: cuotasTit ? null : pctTit ? +pctTit[1] : parsePct(terms),
      cuotas: cuotasTit ? +cuotasTit[1] : parseCuotas(terms),
      dias: DIAS.map((d, k) => c.daysToShow[d] ? k : -1).filter(k => k >= 0),
      local: !!c.availableOn?.store, online: !!c.availableOn?.online, tiendas: null,
      tope: parseTope(terms), minimo: parseMinimo(terms),
      desde: vig?.desde || null, hasta: vig?.hasta || null, cuando: null,
      soloSinOferta: false, acumulable: acumulable(terms),
      resumen: titulo, legal: recortar(terms, 1500), url: URLS.dia,
      img: c.displayData?.cardImage || null,
    };
  });
}
// Lee el array JSON que empieza en html[pos] (el HTML lo trae con /, <... que JSON entiende).
function parseJSONAt(s, pos) {
  let depth = 0, inStr = false;
  for (let i = pos; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (ch === "\\") i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { if (--depth === 0) return JSON.parse(s.slice(pos, i + 1)); }
  }
  throw new Error("JSON sin cerrar");
}

// ---------- Carrefour ----------
async function promosCarrefour() {
  const h = { ...UA, accept: "application/vnd.vtex.ds.v10+json", "rest-range": "resources=0-999" };
  const campos = ["id", "title", "sub_title", "discount_percentage", "discounts_amount_installments", "img_card", "img_card_2",
    "active_from", "active_to", "active", "validText", "hyper", "market", "ecommerce", "express", "maxi", "legal",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "idBank"];
  const ahora = new Date().toISOString().slice(0, 19);
  const url = `${URLS.carrefour}?_fields=${campos.join(",")}&_where=${encodeURIComponent(`active=true AND active_to>${ahora}`)}`;
  const [r, rb] = await Promise.all([fetch(url, { headers: h }), fetch(URLS.carrefourBancos, { headers: h })]);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const bancos = rb.ok ? Object.fromEntries((await rb.json()).map(b => [b.id, b.name])) : {};
  const DIAS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const fecha = (s, fin) => {
    if (!s) return null;
    const d = new Date(s);
    // active_to suele ser "2026-12-01T00:00" = vale hasta el 30/11 inclusive.
    if (fin && d.getUTCHours() === 0 && d.getUTCMinutes() === 0) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  return (await r.json()).filter(p => p.title).map(p => {
    const texto = `${p.title} ${p.sub_title || ""}`;
    const formatos = [p.hyper && "Hiper", p.market && "Market", p.express && "Express", p.maxi && "Maxi"].filter(Boolean);
    const local = !!(p.hyper || p.market || p.express); // Maxi es mayorista: aparte
    return {
      id: "carrefour:" + p.id, super: "carrefour", ...clasificarMedio(texto, bancos[p.idBank]),
      pct: p.discount_percentage || null,
      cuotas: p.discounts_amount_installments ? +p.discounts_amount_installments || parseCuotas(texto) : parseCuotas(texto),
      dias: DIAS.map((d, k) => p[d] ? k : -1).filter(k => k >= 0),
      local, online: !!p.ecommerce,
      tiendas: [formatos.length ? "Carrefour " + formatos.join(", ") : null, p.ecommerce ? "online" : null].filter(Boolean).join(" · ") || null,
      tope: parseTope(p.title) || parseTope(p.sub_title || "") || parseTope(p.legal || ""), minimo: parseMinimo(texto) || parseMinimo(p.legal || ""),
      desde: fecha(p.active_from), hasta: fecha(p.active_to, true), cuando: p.validText || null,
      soloSinOferta: false, acumulable: acumulable(texto),
      resumen: recortar(texto, 220), legal: recortar(p.legal, 1500), url: URLS.carrefourLegal,
    };
  });
}

// ---------- Todo junto ----------
// Devuelve { updated, promos: [...], errors: { súper: mensaje } }. Saca vencidas, futuras lejanas,
// sin descuento ni cuotas, y repetidas (Coto y Dia a veces publican la misma promo dos veces).
async function bajarPromos() {
  const out = { updated: new Date().toISOString(), promos: [], errors: {} };
  const hoy = hoyAR(), en40 = hoyAR(new Date(Date.now() + 40 * 864e5));
  for (const [s, f] of [["coto", promosCoto], ["dia", promosDia], ["carrefour", promosCarrefour]]) {
    try {
      const vistos = new Set();
      const ps = (await f()).filter(p => {
        if (!p.medio || (!p.pct && !p.cuotas) || !p.dias.length) return false;
        if (p.hasta && p.hasta < hoy) return false;
        if (p.desde && p.desde > en40) return false;
        const k = [p.medio, p.banco, p.pct, p.cuotas, p.dias.join(""), p.local, p.online, p.tope, norm(p.resumen).slice(0, 60)].join("|");
        if (vistos.has(k)) return false;
        vistos.add(k); return true;
      });
      out.promos.push(...ps);
      console.log(`promos ${s}: ${ps.length}`);
    } catch (e) {
      out.errors[s] = e.message;
      console.error(`promos ${s}: ERROR ${e.message}`);
    }
  }
  return out;
}

module.exports = { bajarPromos, parseTope, parseMinimo, parsePct, parseVigencia };

if (require.main === module) {
  const fs = require("fs"), path = require("path");
  bajarPromos().then(o => {
    if (!o.promos.length) process.exit(1);
    fs.writeFileSync(path.join(__dirname, "data", "promos.json"), JSON.stringify(o));
  });
}
