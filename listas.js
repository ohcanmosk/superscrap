// SuperScrap - catálogo completo (rama "catalogo" del repo, lo arma catalogo.js) y pestaña "🧾 Listas".
// Se carga antes del script principal de index.html. Usa funciones de ese script (priceFor, pagosDe, cuponesDe,
// searchConf, medioLabel, store, fmt, esc...) solo dentro de funciones, que se llaman después de que cargó todo.
"use strict";

// ---------- Catálogo completo ----------
// Se baja una vez y se guarda en la Cache Storage del navegador; se vuelve a bajar cuando cambia meta.json.
const CAT_CACHE = "superscrap-catalogo";
let catalogo = null;   // { dia: { updated, rows: [{ r, n }] }, coto: ..., carrefour: ... }  r = fila del archivo, n = nombre normalizado
let catalogoP = null;
let catalogoVer = 0;   // sube cada vez que se carga, para invalidar los cálculos guardados
function cargarCatalogo(forzar) {
  if (catalogoP && !forzar) return catalogoP;
  return catalogoP = (async () => {
    let cache = null; try { cache = await caches.open(CAT_CACHE); } catch {}
    const base = await localServerBase();
    // Con el servidor local, si existe la carpeta catalogo/ (node catalogo.js) se usa esa.
    let url = window.SuperScrapCats.CATALOGO_URL;
    if (base != null) { try { const r = await fetchT(base + "/catalogo/meta.json", 4000); if (r.ok) url = new URL((base || ".") + "/catalogo/", location.href).href; } catch {} }
    let meta = null;
    try { const r = await fetchT(url + "meta.json", 15000); if (r.ok) meta = await r.json(); } catch {}
    const prev = store.get("catalogoMeta", null);
    const vigente = meta && prev && prev.updated === meta.updated;
    const out = {};
    await Promise.all(STORES.map(async s => {
      const u = url + s + ".json";
      let j = null;
      const desdeCache = async () => { if (!cache) return null; try { const r = await cache.match(u); return r ? await r.json() : null; } catch { return null; } };
      if (!meta || vigente) j = await desdeCache();
      if (!j) {
        try {
          const r = await fetchT(u, 120000);
          if (r.ok) { if (cache) { try { await cache.put(u, r.clone()); } catch {} } j = await r.json(); }
        } catch {}
      }
      if (!j) j = await desdeCache(); // sin conexión: la última copia
      if (j?.items) out[s] = { updated: j.updated, rows: j.items.map(r => ({ r, n: norm(r[2]) })) };
    }));
    if (meta) store.set("catalogoMeta", meta);
    catalogo = out; catalogoVer++;
    if (!Object.keys(out).length) catalogoP = null; // que se pueda reintentar
    return out;
  })();
}
// Fila del catálogo → producto con el mismo formato que normVtex/normCoto.
function prodDeCatalogo(s, r) {
  const [id, sku, name, brand, shelf, list, promos, cat, url] = r;
  const ps = (promos || []).map(([qty, unit, text]) => ({ qty, unit, text }));
  const host = s === "dia" ? "https://diaonline.supermercadosdia.com.ar/" : "https://www.carrefour.com.ar/";
  const sz = tamano(name, null);
  return {
    store: s, id: String(id), sku: sku ? String(sku) : null, name, brand: brand || "", img: "",
    url: s === "coto" ? "https://www.cotodigital.com.ar/sitios/cdigi/productos" + url : host + url + "/p",
    size: sz ? sz.size : null, unit: sz ? sz.unit : null, detalle: null,
    shelf, list, promos: ps, hasPromo: ps.length > 0 || list > shelf,
    tipo: /sachet|fresca/i.test(name) ? "sachet" : "larga", cat: cat || "", stock: {}, deCatalogo: true,
  };
}
// Búsqueda libre sobre el catálogo (cuando no se puede consultar en vivo): mismas palabras y exclusiones.
async function buscarEnCatalogo(s, c, max = 400) {
  const cat = await cargarCatalogo();
  if (!cat[s]) throw new Error("catálogo no disponible");
  return cat[s].rows.filter(x => c.include.every(rx => rx.test(x.n)) && !(c.exclude && c.exclude.test(x.n)))
    .slice(0, max).map(x => prodDeCatalogo(s, x.r));
}
function catalogoFecha() {
  const ds = Object.values(catalogo || {}).map(x => x.updated).filter(Boolean).sort();
  return ds.length ? new Date(ds[0]).toLocaleString("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
}

// ---------- Listas de compras (se guardan en este dispositivo) ----------
// listas = [{ id, nombre, items: [{ id, q, marca, tam, cant, fijos: { <súper>: <id producto> } }] }]
let listas = [], listaSel = null;
// Ítems desplegados (el último que se agregó queda abierto; el resto minimizados en una línea).
let abiertos = new Set();
const guardarListas = () => { store.set("listas", listas); store.set("listaSel", listaSel); };
const listaActual = () => listas.find(l => l.id === listaSel) || null;
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Tamaño o talle pedido: "500 g", "1 L", "1,5 kg" → { size, unit }; "M", "talle XG", "blend" → palabra que tiene que estar.
function parseTam(t) {
  t = (t || "").trim(); if (!t) return null;
  const s = window.SuperScrapComun.parseSize(t);
  if (s) return { size: s.size, unit: s.unit, txt: t };
  const w = norm(t).replace(/^talle\s+/, "").trim();
  return w ? { rx: new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`), txt: t } : null;
}
// ¿La fila del catálogo cumple lo que pide el ítem? (palabras, -exclusiones, marca, tamaño/talle)
function filtroItem(it) {
  const c = searchConf(it.q || "", []);
  const marca = (it.marca || "").trim() ? norm(it.marca).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() : null;
  const tam = parseTam(it.tam);
  const limpia = s => norm(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ");
  return x => {
    if (!c.include.length || !c.include.every(rx => rx.test(x.n)) || (c.exclude && c.exclude.test(x.n))) return false;
    if (marca && !limpia(x.r[3]).includes(marca) && !limpia(x.r[2]).includes(marca)) return false;
    if (tam) {
      if (tam.rx) return tam.rx.test(x.n);
      const s = window.SuperScrapComun.parseSize(x.r[2]);
      return !!s && s.unit === tam.unit && Math.abs(s.size - tam.size) / tam.size < 0.03;
    }
    return true;
  };
}
// Costo de n unidades sin descuentos de medio de pago: precio de 1 (o promo de 1 unidad) y promos por cantidad
// ("2da al 50%" se aplica de a pares: con 3 unidades, 2 con promo y 1 a precio normal).
function costoLinea(p, n) {
  let uno = p.shelf, notaUno = "";
  const promos = promosDe(p);
  promos.filter(x => x.qty <= 1).forEach(x => { if (x.unit < uno) { uno = x.unit; notaUno = x.text; } });
  let best = { v: n * uno, nota: notaUno, promo: !!notaUno };
  for (const x of promos) {
    if (x.qty <= 1 || n < x.qty) continue;
    const g = Math.floor(n / x.qty) * x.qty, v = g * x.unit + (n - g) * uno;
    if (v < best.v - 0.005) best = { v, nota: x.text + (n > g ? ` (${g} de ${n} con promo)` : ""), promo: true };
  }
  return { ...best, uno };
}
// Candidatos de un ítem en un súper, del más conveniente al menos: con tamaño pedido, por precio;
// sin tamaño, por precio por kg/L (los de tamaño desconocido al final).
const memoCands = new Map();
function candidatos(it, s) {
  const desc = it.descartes?.[s] || [];
  const key = [catalogoVer, s, it.q, it.marca, it.tam, it.cant, !!S.medios.comunidad, desc.join(",")].join("|");
  if (memoCands.has(key)) return memoCands.get(key);
  const rows = catalogo?.[s]?.rows || [];
  const f = filtroItem(it), n = it.cant || 1, conTam = !!parseTam(it.tam);
  const cs = rows.filter(x => f(x) && !desc.includes(String(x.r[0]))).map(x => { const p = prodDeCatalogo(s, x.r); const c = costoLinea(p, n); return { p, c, u: c.v / n }; });
  const k = x => conTam || !x.p.size ? null : x.u / x.p.size;
  cs.sort((a, b) => { const ka = k(a), kb = k(b); if (ka != null && kb != null) return ka - kb; if (ka != null) return -1; if (kb != null) return 1; return a.u - b.u; });
  const out = cs.slice(0, 30);
  memoCands.set(key, out);
  return out;
}
// Producto elegido para el ítem en ese súper: el fijado por el usuario (si sigue en el catálogo) o el más conveniente.
// fijos[s] = "-": el usuario dijo que en ese súper no hay nada que le sirva (cuenta como faltante).
const NINGUNO = "-";
function elegido(it, s) {
  const fijo = it.fijos?.[s];
  if (fijo === NINGUNO) return null;
  if (fijo) {
    const x = (catalogo?.[s]?.rows || []).find(x => String(x.r[0]) === fijo);
    if (x) { const p = prodDeCatalogo(s, x.r); return { p, c: costoLinea(p, it.cant || 1), fijo: true }; }
  }
  const c = candidatos(it, s)[0];
  return c ? { p: c.p, c: c.c, fijo: false, fijoPerdido: !!fijo } : null;
}
const topeNum = t => { const m = /\$\s*([\d.]+)/.exec(t || ""); return m ? +m[1].replace(/\./g, "") : null; };
// Total de la lista en un súper el día d: promos del producto, el mejor medio de pago (respetando compra mínima,
// tope y "solo productos sin oferta"; no se suma a promos ni ofertas salvo que sea acumulable) y el cupón Club Dia.
function totalSuper(s, lista, d) {
  const lineas = lista.items.map(it => { const e = elegido(it, s); return e ? { it, n: it.cant || 1, ...e } : { it, falta: true }; });
  const ok = lineas.filter(l => !l.falta);
  const base = ok.reduce((a, l) => a + l.c.v, 0);
  let mejor = null;
  for (const P of [null, ...pagosDe(s, d)]) {
    if (P && P.minimo && base < P.minimo) continue; // no llega a la compra mínima
    const k = P ? 1 - P.pct / 100 : 1, txt = P ? `−${P.pct}% ${medioLabel(P)}` : "";
    const det = ok.map(l => {
      const sinPago = { ...l, v: l.c.v, nota: l.c.nota, ahorro: 0 };
      if (!P || !pagoAplica(P, l.p)) return sinPago;
      const goNdola = l.n * l.p.shelf, conPago = goNdola * k;          // medio de pago sobre el precio de góndola
      const conPromo = P.acumulable ? l.c.v * k : l.c.v;               // o la promo del producto (+ pago si es acumulable)
      if (conPago < conPromo) return { ...l, v: conPago, nota: txt, ahorro: goNdola - conPago };
      return P.acumulable ? { ...l, v: conPromo, nota: [l.c.nota, txt].filter(Boolean).join(" · "), ahorro: l.c.v - conPromo } : sinPago;
    });
    let ahorro = det.reduce((a, x) => a + x.ahorro, 0), extra = 0;
    const tope = P ? topeNum(P.tope) : null;
    if (tope != null && ahorro > tope) { extra = ahorro - tope; ahorro = tope; }
    const total = det.reduce((a, x) => a + x.v, 0) + extra;
    if (!mejor || total < mejor.total - 0.5) mejor = { total, det, pago: P && ahorro > 0 ? P : null, ahorroPago: ahorro, topeAlcanzado: extra > 0 };
  }
  // Cupón Club Dia: encima de todo, salvo productos excluidos.
  const cup = cuponesDe(s, d)[0];
  let ahorroCupon = 0;
  if (cup) for (const x of mejor.det) {
    if (excluido(x.p, cup)) continue;
    const a = x.v * pctDe(cup) / 100; x.v -= a; ahorroCupon += a;
    x.nota = [x.nota, `−${pctDe(cup)}% cupón ${medioLabel(cup)}`].filter(Boolean).join(" · ");
  }
  return {
    s, total: mejor.total - ahorroCupon, base, pago: mejor.pago, ahorroPago: mejor.ahorroPago, topeAlcanzado: mejor.topeAlcanzado,
    cup: ahorroCupon ? cup : null, ahorroCupon,
    lineas: lineas.map(l => l.falta ? l : mejor.det.find(x => x.it === l.it)), faltan: lineas.filter(l => l.falta).map(l => l.it),
  };
}

// Para el histórico de la lista (historico.html): qué producto se eligió hoy en cada súper para cada ítem.
// Se guarda en "listasElegidos" = { <id lista>: { nombre, at, items: [{ id, txt, cant, ids: { <súper>: id | null }, nombres }] } }.
function guardarElegidos(l) {
  const todos = store.get("listasElegidos", {});
  for (const id of Object.keys(todos)) if (!listas.some(x => x.id === id)) delete todos[id];
  todos[l.id] = { nombre: l.nombre, at: new Date().toISOString(), items: l.items.map(it => {
    const ids = {}, nombres = {};
    STORES.filter(s => catalogo[s]).forEach(s => { const e = elegido(it, s); ids[s] = e ? e.p.id : null; if (e) nombres[s] = e.p.name; });
    return { id: it.id, txt: itemTexto(it), cant: it.cant || 1, ids, nombres };
  }) };
  store.set("listasElegidos", todos);
}

// ---------- Render ----------
function itemTexto(it) {
  return [it.q, it.marca && `marca ${it.marca}`, it.tam].filter(Boolean).join(" · ");
}
function renderListas() {
  // Listas
  const l = listaActual();
  $("lSel").innerHTML = listas.length ? listas.map(x => `<option value="${esc(x.id)}" ${x.id === listaSel ? "selected" : ""}>${esc(x.nombre)} (${x.items.length})</option>`).join("")
    : `<option value="">(todavía no hay listas)</option>`;
  $("lRen").disabled = $("lDel").disabled = !l;
  // Días
  $("lDays").innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d =>
    `<button class="day ${d === selDay ? "on" : ""} ${d === todayIdx ? "today" : ""}" data-d="${d}">${DAYS[d]}${d === todayIdx ? `<span class="hidemob"> (hoy)</span>` : ""}</button>`).join("");
  if (!catalogo) {
    $("lRes").innerHTML = `<div class="empty">Cargando el catálogo de los súper (la primera vez baja ~1 MB)…</div>`;
    $("lItems").innerHTML = "";
    cargarCatalogo().then(() => cat === LISTAS && render());
    return;
  }
  if (!Object.keys(catalogo).length) {
    $("lRes").innerHTML = `<div class="empty">No se pudo cargar el catálogo. Revisá la conexión y tocá “↻ Actualizar”.</div>`;
    $("lItems").innerHTML = ""; return;
  }
  const cuando = catalogoFecha();
  $("lInfo").textContent = `Precios del catálogo del ${cuando || "?"} (se actualiza 1 vez por día)` +
    (STORES.some(s => !catalogo[s]) ? " · sin datos de " + STORES.filter(s => !catalogo[s]).map(storeName).join(", ") : "");
  // Ítems: qué eligió en cada súper (se puede cambiar)
  // Minimizados: nombre, cantidad y el precio en cada súper (el más barato en verde). Los más nuevos arriba.
  $("lItems").innerHTML = !l ? `<div class="empty">Creá una lista con “+ Nueva”.</div>` : !l.items.length ? `<div class="empty">Agregá productos con el formulario de arriba.</div>` :
    l.items.slice().reverse().map(it => {
      const precios = STORES.filter(s => catalogo[s]).map(s => ({ s, e: elegido(it, s) }));
      const min = Math.min(...precios.filter(x => x.e).map(x => x.e.c.v));
      const mini = precios.map(({ s, e }) => `<span class="mp ${e && e.c.v === min ? "low" : ""}"><span class="dot ${s}"></span>${e ? fmt(e.c.v) : "—"}</span>`).join("");
      return `<details class="litem" data-item="${esc(it.id)}" ${abiertos.has(it.id) ? "open" : ""}>
      <summary class="lihead"><span class="lq">${esc(itemTexto(it))}${(it.cant || 1) > 1 ? ` <span class="sub">×${it.cant}</span>` : ""}</span><span class="lmini">${mini}</span></summary>
      <div class="libody">
      <div class="lirow"><label class="lcant">Cantidad <input type="number" min="1" max="99" value="${it.cant || 1}" data-cant="${esc(it.id)}"></label>
        <button class="del" data-delit="${esc(it.id)}" title="Sacar de la lista">✕ Sacar</button></div>
      ${STORES.filter(s => catalogo[s]).map(s => {
        const cs = candidatos(it, s), e = elegido(it, s), ninguno = it.fijos?.[s] === NINGUNO;
        const nDesc = (it.descartes?.[s] || []).length;
        const recuperar = nDesc ? ` <button class="linkbtn" data-undesc="${esc(it.id)}|${s}">recuperar descartados (${nDesc})</button>` : "";
        const opts = !e ? cs : cs.some(x => x.p.id === e.p.id) ? cs : [{ p: e.p, c: e.c }, ...cs];
        const select = `<select data-pick="${esc(it.id)}|${s}" title="${esc(e ? e.p.name : "")}">
            <option value="" ${!e || e.fijo ? "" : "selected"}>Automático: el más conveniente</option>
            <option value="${NINGUNO}" ${ninguno ? "selected" : ""}>✕ Ninguno: no comprar en ${storeName(s)}</option>
            ${opts.map(x => `<option value="${esc(x.p.id)}" ${e && e.fijo && x.p.id === e.p.id ? "selected" : ""}>${esc(x.p.name)} — ${fmt(x.p.shelf)}</option>`).join("")}
          </select>`;
        if (!e) return `<div class="lcand"><span class="dot ${s}"></span>${cs.length || ninguno ? select : ""}<span class="sub lnone">${ninguno ? "no se compra acá" : nDesc ? "descartaste los que había" : "no se encontró"}</span></div>` +
          (recuperar ? `<div class="lauto sub">${recuperar}</div>` : "");
        return `<div class="lcand"><span class="dot ${s}"></span>${select}<b class="lprecio">${fmt(e.c.v)}</b></div>` +
          `<div class="lauto sub">${e.fijo ? "" : esc(e.p.name) + (e.fijoPerdido ? " (el que habías elegido ya no está)" : "") +
            ` <button class="linkbtn" data-desc="${esc(it.id)}|${s}|${esc(e.p.id)}" title="No es lo que busco: elegir el siguiente">✕ descartar</button>`}${recuperar}</div>`;
      }).join("")}
      </div></details>`;
    }).join("");
  // Resultado: a qué súper conviene ir
  if (!l || !l.items.length) { $("lRes").innerHTML = ""; return; }
  guardarElegidos(l);
  const res = STORES.filter(s => catalogo[s]).map(s => totalSuper(s, l, selDay))
    .sort((a, b) => a.faltan.length - b.faltan.length || a.total - b.total);
  const win = res[0];
  const diaTxt = selDay === todayIdx ? "hoy" : "el " + DAYS_FULL[selDay];
  $("lRes").innerHTML = `<div class="lwin ${win.s}"><div class="sub">Conviene ir ${diaTxt} a</div>
      <div class="store">${storeName(win.s)}</div><div class="price">${fmt(win.total)}</div>
      ${win.faltan.length ? `<div class="tag warn">no encontró ${win.faltan.length} producto${win.faltan.length > 1 ? "s" : ""}</div>` : ""}</div>` +
    res.map(r => {
      const dif = r.total - win.total;
      return `<details class="lsup ${r === win ? "win" : ""}"><summary><span class="dot ${r.s}"></span><b>${storeName(r.s)}</b>
          <b class="lt">${fmt(r.total)}</b>
          ${r === win ? `<span class="tag good">conviene</span>` : r.faltan.length > win.faltan.length && dif <= 0 ? "" : `<span class="sub">+${fmt(dif)} (${(dif / win.total * 100).toFixed(1)}%)</span>`}
          ${r.faltan.length ? `<span class="tag warn">faltan ${r.faltan.length}</span>` : ""}</summary>
        <div class="tablewrap"><table class="ltab"><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Subtotal</th></tr>
        ${r.lineas.map(x => x.falta ? `<tr><td colspan="3" class="sub">✕ ${esc(itemTexto(x.it))}: ${x.it.fijos?.[r.s] === NINGUNO ? "elegiste no comprarlo" : (x.it.descartes?.[r.s] || []).length ? "descartaste los que había" : "no se encontró"} en ${storeName(r.s)}</td></tr>`
          : `<tr><td><a href="${esc(x.p.url)}" target="_blank" rel="noopener">${esc(x.p.name)}</a><div class="sub">${fmt(x.p.shelf)} c/u${x.nota ? " · " + esc(x.nota) : ""}</div></td>
              <td class="n">${x.n}</td><td class="n">${fmt(x.v)}</td></tr>`).join("")}
        ${r.ahorroPago ? `<tr><td colspan="3" class="sub">Ahorro con ${esc(medioLabel(r.pago))}: ${fmt(r.ahorroPago)}${r.topeAlcanzado ? " (llega al tope)" : ""}</td></tr>` : ""}
        ${r.ahorroCupon ? `<tr><td colspan="3" class="sub">Ahorro con cupón ${esc(medioLabel(r.cup))}: ${fmt(r.ahorroCupon)}</td></tr>` : ""}
        </table></div></details>`;
    }).join("") +
    `<div class="sub" style="margin-top:8px">Incluye promos del producto y tus medios de pago del día (compra mínima y tope de reintegro incluidos). Tocá cada súper para ver qué eligió.</div>` +
    `<a class="ghostlink" style="display:inline-block;margin-top:8px" href="historico.html?lista=${encodeURIComponent(l.id)}">📈 Ver cómo varió el total de esta lista (30 días)</a>`;
}

// ---------- Eventos ----------
function initListas() {
  listas = store.get("listas", []);
  listaSel = store.get("listaSel", null);
  if (!listaActual() && listas.length) listaSel = listas[0].id;
  const nueva = nombre => { const l = { id: nuevoId(), nombre, items: [] }; listas.push(l); listaSel = l.id; guardarListas(); return l; };
  $("lSel").onchange = () => { listaSel = $("lSel").value; guardarListas(); render(); };
  $("lNueva").onclick = () => { const n = prompt("Nombre de la lista:", "Compra semanal"); if (n && n.trim()) { nueva(n.trim()); render(); } };
  $("lRen").onclick = () => { const l = listaActual(); if (!l) return; const n = prompt("Nuevo nombre:", l.nombre); if (n && n.trim()) { l.nombre = n.trim(); guardarListas(); render(); } };
  $("lDel").onclick = () => {
    const l = listaActual(); if (!l || !confirm(`¿Borrar la lista “${l.nombre}”?`)) return;
    listas = listas.filter(x => x !== l); listaSel = listas[0]?.id || null; guardarListas(); render();
  };
  $("lForm").onsubmit = ev => {
    ev.preventDefault();
    const q = $("lQ").value.trim(); if (!q) return;
    const l = listaActual() || nueva("Mi lista");
    const nuevo = { id: nuevoId(), q, marca: $("lMarca").value.trim(), tam: $("lTam").value.trim(), cant: Math.max(1, +$("lCant").value || 1), fijos: {} };
    l.items.push(nuevo);
    abiertos = new Set([nuevo.id]); // el nuevo abierto, los anteriores minimizados
    guardarListas();
    $("lQ").value = $("lMarca").value = $("lTam").value = ""; $("lCant").value = 1; $("lQ").focus();
    render();
  };
  // Recordar qué ítems abrió o cerró el usuario (para que no se cierren al recalcular).
  $("lItems").addEventListener("toggle", ev => {
    const id = ev.target.dataset?.item; if (!id) return;
    if (ev.target.open) abiertos.add(id); else abiertos.delete(id);
  }, true);
  $("lItems").addEventListener("click", ev => {
    const l = listaActual(); if (!l) return;
    const ds = ev.target.dataset || {};
    if (ds.delit) { l.items = l.items.filter(it => it.id !== ds.delit); }
    else if (ds.desc) { // descartar el elegido automáticamente: pasa al siguiente
      const [id, s, pid] = ds.desc.split("|"); const it = l.items.find(x => x.id === id); if (!it) return;
      it.descartes = it.descartes || {}; it.descartes[s] = [...new Set([...(it.descartes[s] || []), pid])];
    } else if (ds.undesc) {
      const [id, s] = ds.undesc.split("|"); const it = l.items.find(x => x.id === id); if (!it?.descartes) return;
      delete it.descartes[s];
    } else return;
    guardarListas(); render();
  });
  $("lItems").addEventListener("change", ev => {
    const l = listaActual(); if (!l) return;
    const t = ev.target;
    if (t.dataset.cant) { const it = l.items.find(x => x.id === t.dataset.cant); if (it) it.cant = Math.max(1, Math.min(99, +t.value || 1)); }
    else if (t.dataset.pick) {
      const [id, s] = t.dataset.pick.split("|"); const it = l.items.find(x => x.id === id); if (!it) return;
      it.fijos = it.fijos || {}; if (t.value) it.fijos[s] = t.value; else delete it.fijos[s];
    } else return;
    guardarListas(); render();
  });
  $("lDays").onclick = ev => { const d = ev.target.closest("[data-d]")?.dataset.d; if (d == null) return; selDay = +d; render(); };
}
