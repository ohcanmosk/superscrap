// SuperScrap - descuentos con billeteras y bancos (Mercado Pago, MODO, Cuenta DNI, bancos...)
// que publican Coto, Dia y Carrefour en sus webs. Los baja y los deja todos con el mismo formato
// en data/promos.json, que muestra la pestaña "💳 Descuentos" y usa el ranking de precios.
// Lo llama scrape.js; también se puede correr solo: node promos.js
//
// Fuentes (ninguna es una API oficial; si un súper cambia su web, puede dejar de andar):
// - Coto: el servicio que usa coto.com.ar/descuentos (JSON, permite CORS).
// - Dia: la página "medios de pago y promociones" trae las tarjetas de promos como JSON dentro del HTML.
// - Carrefour: Master Data pública de VTEX (entidad BP = promos bancarias, FB = bancos).

const { norm, clasificarMedio, MEDIOS } = require("./comun.js");

const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" };
const URLS = {
  coto: "https://www.coto.com.ar/rest/model/atg/actors/cProfileActor/getPromocionesMulticanal",
  cotoLegal: "https://www.coto.com.ar/terminos-descuentos",
  // Los mismos términos legales como JSON (Endeca): ahí están las promos "de fin de semana" que Coto
  // publica semana a semana (ej. 20% con Mercado Pago sáb y dom) y que no figuran en el servicio de arriba.
  cotoLegales: "https://www.coto.com.ar/sitios/cdigi/terminos-descuentos?format=json",
  dia: "https://diaonline.supermercadosdia.com.ar/medios-de-pago-y-promociones",
  // Legales de Dia: ahí están los cupones Club Dia ("Cupón 24/11/2026" = el de los martes, "Cupón ClubDia +60").
  diaLegales: "https://diaonline.supermercadosdia.com.ar/legales",
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
  const m = n.match(new RegExp(`(?:tope|limite)(?: maximo)?(?: (?:de |del )?(?:reintegro|devolucion|descuento|beneficio))*(?: es)?:?\\s*(?:de\\s*)?(?:hasta\\s*)?\\$\\s*([\\d.,]+)\\s*((?:por|x) ${U}(?:,? (?:y )?(?:por )?${U})?)?`));
  // Si "sin tope" aparece antes que un tope con monto, manda "sin tope" (el monto suele ser de un adicional).
  const st = n.search(/sin tope/);
  if (st >= 0 && (!m || st < m.index)) return "Sin tope";
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

// Fechas puntuales de una promo: "desde el 21 hasta el 22 de noviembre de 2026",
// "los días sábado 28 de noviembre y domingo 29 de noviembre de 2026", "jueves 19 de noviembre de 2026".
// Devuelve la lista de días (YYYY-MM-DD) o null. Solo mira el principio del texto (la vigencia).
function fechasPuntuales(texto) {
  const n = norm(texto).slice(0, 500), mes = MESES.join("|");
  const rango = n.match(new RegExp(`(\\d{1,2})(?: de (${mes}))?(?: de(?:l)? \\d{4})?\\s+(?:y|hasta el|al|a)\\s+(?:[a-z]+ )?(\\d{1,2}) de (${mes}) de(?:l)? (\\d{4})`));
  let a, b;
  if (rango) {
    const y = +rango[5], m2 = MESES.indexOf(rango[4]) + 1, m1 = rango[2] ? MESES.indexOf(rango[2]) + 1 : m2;
    a = new Date(Date.UTC(y, m1 - 1, +rango[1])); b = new Date(Date.UTC(y, m2 - 1, +rango[3]));
  } else {
    const uno = n.match(new RegExp(`(\\d{1,2}) de (${mes}) de(?:l)? (\\d{4})`));
    if (!uno) return null;
    a = b = new Date(Date.UTC(+uno[3], MESES.indexOf(uno[2]), +uno[1]));
  }
  const out = [];
  for (const d = new Date(a); d <= b && out.length < 8; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out.length ? out : null;
}
// Promos de una sola ciudad/provincia (no aplican en zona oeste del GBA).
const REGIONAL = /mar del plata|neuquen|mendoza|santa fe|entre rios|cordoba|rosario|la plata|bahia blanca|tucuman|salta/;
// Saca del texto legal las menciones en negativo ("no será aplicado en compras realizadas a través de Mercadopago").
const sinNegaciones = t => t.replace(/no (?:ser[aá]|es|son) (?:aplicad|v[aá]lid)[^.]*\./gi, " ").replace(/(?:abonadas|realizadas) mediante billeteras virtuales/gi, " ");
// Medio de una tarjeta legal: manda el título ("BANCO ICBC...", "BENEFICIO ANSES..."); el texto solo suma MODO
// ("Credicoop ... a través de QR MODO") o decide si el título no dice nada ("DESCUENTOS SÁBADO Y DOMINGO").
function medioLegal(titulo, cuerpo) {
  const c = sinNegaciones(cuerpo).slice(0, 1200), tit = clasificarMedio(titulo);
  if (!tit.medio) return clasificarMedio(c);
  if (tit.medio !== "modo" && /\bmodo\b/.test(norm(c)) && MEDIOS[tit.medio].tipo === "banco")
    return { medio: "modo", banco: tit.medio };
  return tit;
}
// Términos legales de Coto: tarjetas con título ("DESCUENTOS SÁBADO Y DOMINGO", "BANCO ICBC FIN DE SEMANA...")
// y texto. Se toman solo las promos de pocos días (hasta 4) con % de descuento y un medio de pago reconocible.
async function promosCotoLegales() {
  const r = await fetch(URLS.cotoLegales, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const html = (j.Main || []).map(x => x.content || "").join("");
  const ent = s => s.replace(/&nbsp;/g, " ").replace(/&([a-z])(acute|tilde|uml);/gi, "$1").replace(/&ntilde;/gi, "ñ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ");
  const out = [];
  for (const card of html.split(/class="legal-card"/).slice(1)) {
    const titulo = ent((card.match(/legal-header"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "").replace(/\s+/g, " ").trim();
    const cuerpo = ent(((card.match(/legal-body"[^>]*>([\s\S]*)/) || [])[1] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const fechas = fechasPuntuales(cuerpo);
    if (!titulo || !fechas || fechas.length > 4) continue;
    // Si la tarjeta junta varios beneficios "(1) ... (2) ...", se usa el primero (el de descuento).
    const primero = cuerpo.split(/\s\(2\)\s/)[0];
    const t = norm(titulo);
    if (REGIONAL.test(t)) continue;
    const pct = parsePct(primero), { medio, banco } = medioLegal(titulo, primero);
    if (!pct || !medio || /cuotas/i.test(titulo)) continue;
    const online = /online/.test(t), local = /presencial/.test(t) || !online;
    const dias = [...new Set(fechas.map(f => new Date(f + "T12:00:00Z").getUTCDay()))];
    const fd = f => f.slice(8) + "/" + f.slice(5, 7);
    out.push({
      id: "coto:legal:" + t.replace(/[^a-z0-9]+/g, "-") + ":" + fechas[0], super: "coto", medio, banco, puntual: true,
      pct, cuotas: null, dias, local, online, tiendas: local ? "Sucursales Coto" : "Coto Digital (online)",
      tope: parseTope(primero), minimo: parseMinimo(primero),
      desde: fechas[0], hasta: fechas[fechas.length - 1],
      cuando: fechas.length === 1 ? fd(fechas[0]) : `${fd(fechas[0])} al ${fd(fechas[fechas.length - 1])}`,
      soloSinOferta: /sin oferta/i.test(primero), acumulable: acumulable(primero),
      resumen: titulo.charAt(0) + titulo.slice(1).toLowerCase(), legal: recortar(cuerpo, 1500), url: URLS.cotoLegal,
    });
  }
  return out;
}

// ---------- Coto ----------
// Servicio de promos de coto.com.ar/descuentos + promos puntuales de los términos legales.
async function promosCoto() {
  const [base, legales] = await Promise.all([promosCotoBase(), promosCotoLegales().catch(e => {
    console.error(`promos coto (términos legales): ERROR ${e.message}`); return [];
  })]);
  // Las puntuales que ya están en el servicio (mismo medio, %, día y lugar) no se repiten.
  const nuevas = legales.filter(l => !base.some(b => b.medio === l.medio && b.banco === l.banco && b.pct === l.pct &&
    b.local === l.local && l.dias.every(d => b.dias.includes(d))));
  return base.concat(nuevas);
}
async function promosCotoBase() {
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
  const [promos, club] = await Promise.all([promosDiaPagos(), promosDiaClub().catch(e => {
    console.error(`promos dia (Club Dia): ERROR ${e.message}`); return [];
  })]);
  return promos.concat(club);
}
async function promosDiaPagos() {
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
// Cupón Club Dia de los martes (página de legales, "Cupón 24/11/2026"): toda la compra, cualquier medio de pago,
// sin mínimo ni tope, con exclusiones ("NO INCLUYE LECHES INFANTILES ETAPA 1 Y 2, GOLOSINAS, VINOS, CARNES...").
// El legal NO dice el %: se usa 20% porque es lo que comunica Dia ("cupón ClubDia 20% de cada martes, sin tope
// ni monto mínimo, sobre toda la compra, acumulable con todas las ofertas"; en TikTok: "hasta un 20%").
// No se toman el +60 (sin % publicado vigente), ni cumpleaños ni bienvenida (una sola vez por socio).
const CLUBDIA_PCT = 20, CLUBDIA_PCT_FUENTE = "El legal no dice el %: 20% es lo que comunica Dia (“cupón ClubDia 20% de cada martes”; en sus redes, “hasta 20%”).";
// Exclusiones del cupón → claves que la app reconoce por la categoría del producto en Dia.
const EXCLUSIONES = [["leches-infantiles", /leches? infantil/], ["golosinas", /golosina/], ["vinos", /\bvinos?\b/],
  ["carnes", /\bcarnes?\b/], ["mostrador", /mostrador|venta asistida/]];
const DIAS_TXT = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
function diasDeTexto(n) {
  const d = DIAS_TXT.join("|");
  const r = n.match(new RegExp(`de (${d}) a (${d})`));
  if (r) { const out = []; for (let i = DIAS_TXT.indexOf(r[1]); ; i = (i + 1) % 7) { out.push(i); if (i === DIAS_TXT.indexOf(r[2]) || out.length > 7) break; } return out; }
  const u = n.match(new RegExp(`\\b(?:el|los) (${d})`));
  return u ? [DIAS_TXT.indexOf(u[1])] : null;
}
async function promosDiaClub() {
  const r = await fetch(URLS.diaLegales, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const html = await r.text();
  const txt = s => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const out = [];
  for (const [, q, a] of html.matchAll(/paragraph--main-question-frecuentes">(.*?)<\/p>.*?paragraph--answer1">(.*?)<\/p>/gs)) {
    const titulo = txt(q), cuerpo = txt(a), t = norm(titulo);
    if (!/cupon/.test(t) || !/club ?dia/.test(norm(cuerpo)) || /cumple|bienvenida|\+ ?60/.test(t)) continue;
    const primera = cuerpo.split(/\.\s*\/|\.\/\s*/)[0], n = norm(primera);
    const fecha = titulo.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    let desde, hasta, dias;
    if (fecha) {
      desde = hasta = iso(+fecha[1], +fecha[2], +fecha[3]);
      dias = [new Date(desde + "T12:00:00Z").getUTCDay()];
    } else {
      const v = parseVigencia(primera); if (!v) continue;
      ({ desde, hasta } = v); dias = diasDeTexto(n) || [0, 1, 2, 3, 4, 5, 6];
    }
    const noIncluye = (norm(cuerpo).match(/no incluye ([^(]*)/) || [])[1] || "";
    const pctLegal = parsePct(primera);
    out.push({
      id: "dia:club:clubdia:" + desde, super: "dia", medio: "clubdia", banco: null, cupon: true, puntual: !!fecha,
      pct: pctLegal || CLUBDIA_PCT, pctFuente: pctLegal ? null : CLUBDIA_PCT_FUENTE,
      cuotas: null, dias, local: true, online: true, tiendas: "Tiendas Dia, app y diaonline",
      tope: parseTope(primera), minimo: parseMinimo(primera), desde, hasta, cuando: titulo,
      soloSinOferta: false, acumulable: true,
      excluye: EXCLUSIONES.filter(([, rx]) => rx.test(noIncluye)).map(([k]) => k),
      resumen: titulo + " (cupón semanal de socios Club Dia)",
      legal: recortar(cuerpo, 1500), url: URLS.diaLegales,
    });
  }
  return out;
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
  const out = { updated: new Date().toISOString(), promos: [], vistas: [], errors: {} };
  const hoy = hoyAR(), en40 = hoyAR(new Date(Date.now() + 40 * 864e5));
  for (const [s, f] of [["coto", promosCoto], ["dia", promosDia], ["carrefour", promosCarrefour]]) {
    try {
      const vistos = new Set();
      const todas = await f();
      // Promos puntuales (de 1 a 4 días) vistas, aunque ya hayan vencido: sirven para avisar las habituales.
      out.vistas.push(...todas.filter(p => p.puntual && (p.pct || p.cupon)).map(p => ({ id: p.id, super: p.super, medio: p.medio, banco: p.banco,
        cupon: p.cupon || undefined, acumulable: p.acumulable, pct: p.pct, dias: p.dias, local: p.local, online: p.online, desde: p.desde, hasta: p.hasta, resumen: p.resumen })));
      const ps = todas.filter(p => {
        if (!p.medio || (!p.pct && !p.cuotas && !p.cupon) || !p.dias.length) return false;
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

// ---------- Promos habituales (todavía sin confirmar) ----------
// Coto publica algunas promos semana a semana (ej. "DESCUENTOS SÁBADO Y DOMINGO": 20% con Mercado Pago, a veces 15%)
// recién durante la semana. Con las puntuales vistas en los últimos días (vistas, se guardan en data/promos.json
// entre corridas) se arma "habituales": las que hubo hace poco (terminaron hace 7 días o menos) y que se suelen repetir.
// La app las muestra "sin confirmar" (no las aplica a los precios) para las fechas en que todavía no se publicaron.
const HIST_PROMOS_DIAS = 70;
function combinarHistorial(nuevo, viejo) {
  const hoy = hoyAR(), limite = hoyAR(new Date(Date.now() - HIST_PROMOS_DIAS * 864e5));
  const reciente = hoyAR(new Date(Date.now() - 7 * 864e5));
  const porId = new Map();
  for (const v of [...(viejo?.vistas || []), ...(nuevo.vistas || [])]) if (v.hasta >= limite) porId.set(v.id, v);
  nuevo.vistas = [...porId.values()].sort((a, b) => a.desde.localeCompare(b.desde));
  const grupos = new Map();
  for (const v of nuevo.vistas) {
    const k = [v.super, v.medio, v.banco, [...v.dias].sort().join(""), v.local].join("|");
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(v);
  }
  nuevo.habituales = [];
  for (const vs of grupos.values()) {
    const u = vs[vs.length - 1];
    if (u.hasta < reciente || u.hasta >= hoy) continue; // vieja, o la de esta semana ya está publicada
    if (/\d\s*(?:°|º|er|do)?\s*fin de semana/.test(norm(u.resumen))) continue; // "2° fin de semana": es mensual
    nuevo.habituales.push({ super: u.super, medio: u.medio, banco: u.banco, dias: u.dias, local: u.local, online: u.online,
      cupon: u.cupon, ultimoPct: u.pct, pcts: [...new Set(vs.map(v => v.pct).filter(Boolean))].sort((a, b) => a - b), desde: u.desde, hasta: u.hasta,
      veces: vs.length, resumen: u.resumen });
  }
  return nuevo;
}

module.exports = { combinarHistorial, bajarPromos, parseTope, parseMinimo, parsePct, parseVigencia, fechasPuntuales, promosCotoLegales };

if (require.main === module) {
  const fs = require("fs"), path = require("path");
  bajarPromos().then(o => {
    if (!o.promos.length) process.exit(1);
    const f = path.join(__dirname, "data", "promos.json");
    let viejo = null; try { viejo = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    combinarHistorial(o, viejo);
    fs.writeFileSync(path.join(__dirname, "data", "promos.json"), JSON.stringify(o));
  });
}
