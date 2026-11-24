# CLAUDE.md

Guía para trabajar en este repo. La app y el código están en castellano (rioplatense): mantené ese idioma en textos de la UI, comentarios y commits.

## Qué es

**SuperScrap**: web app (PWA) sin build ni dependencias que compara precios de **Coto**, **Dia** y **Carrefour** (Argentina) y muestra los 4 productos más baratos de cada súper (`TOP_N` en `index.html`), con y sin promo, según el día de la semana (con el mejor descuento del día para los medios de pago del usuario: Mercado Pago, MODO, bancos…).

Pestañas (categorías fijas, definidas en `categorias.js`):
- 🥛 **Leches** (enteras/descremadas, con filtros propios de tipo: larga vida, sachet, especiales).
- ☕ **Café molido**: solo los que dicen *tostado* en el nombre (o marcas que solo venden tostado: Café Martínez, Seattle's Best, Happy Day). Excluye *torrado*, cápsulas, saquitos e instantáneo. Los "Café Molido ... Intenso" sin aclarar se ocultan porque suelen ser torrados.
- 🐟 **Atún en lomitos**: solo "lomitos"/"lomos", sin desmenuzado.
- 🌱 **Milanesas de soja Granja del Sol**.
- 🧻 **Papel higiénico hoja simple** y **doble hoja** (dos pestañas, para no comparar una contra otra): precio **por metro**. Solo entran los que dicen en el nombre "simple"/"S/H" o "doble hoja"/"D/H" ("doble textura" no cuenta). Cada producto muestra la cuenta (`p.detalle`, de `parseMetrosDetalle`/`tamanoCoto`): "4 rollos × 30 m = 120 m" o "12 m² según Coto ≈ 120 m". Auditado el 23/11/2026: los 97 papeles dan rollos × metros correctos y, en Coto, el precio por m² coincide con los metros del nombre.
- 🔎 **Buscar**: búsqueda libre del usuario con la misma lógica (ver abajo).
- 🧾 **Listas**: listas de compras guardadas en el dispositivo; dice a qué súper conviene ir y el total en cada uno (ver "Listas de compras").
- 💳 **Descuentos**: descuentos con billeteras y bancos que publica cada súper, por día (ver "Descuentos con medios de pago").

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Toda la app: HTML + CSS + JS en un solo archivo. Fetch, parseo, cálculo de precios, render y localStorage. |
| `historico.html` | Página aparte (botón "📈 Histórico" del header): lee `data/historial/<cat>.json` y muestra, para 7/14/40 días, lo más barato por kg/L de cada súper día por día (sin promo / con promo), una tabla por día de la semana y el detalle de un producto. Gráficos SVG propios (sin librerías) con tooltip. |
| `comun.js` | Funciones compartidas por `index.html`, `historico.html` y `scrape.js`: `norm`, `parseSize`, `parseDiaTeaser`, `cleanCarrefourTeaser`, `vtexOffer`, `cotoOffer`, `matchesCat`. Cambiar acá la lectura de precios/promos la cambia en la app y en el histórico. Tamaño por categoría con `tamano(name, c)` (`c.medida === "metros"` → `parseMetros`; `c.porDefecto` → 1 L en leches) y `tamanoCoto` (papel de Coto: `sku.referencePrice` es precio por m², metros = precio ÷ ref × 10). |
| `categorias.js` | Config compartida de categorías (URLs de Dia/Coto/Carrefour, filtros regex, unidad, archivos de snapshot) y de "mi zona" (`ZONA`: tiendas cuyo stock se mira). La cargan `index.html` (`window.SuperScrapCats`) y `scrape.js` (`require`). |
| `promos.js` | Baja los descuentos con medios de pago de Coto, Dia y Carrefour y los normaliza (`bajarPromos`). Lo llama `scrape.js`; también `node promos.js` solo. |
| `logos/` | Logos de billeteras/bancos (PNG chicos con fondo blanco, sacados de coto.com.ar). Los referencia `MEDIOS[k].logo` en `comun.js`. |
| `catalogo.js` | Baja el catálogo de supermercado completo de los 3 súper (~33.000 productos, ~1,4 MB comprimido) a `catalogo/<súper>.json` + `meta.json`, formato compacto `[id, sku, nombre, marca, precio, lista, promos, categoría, url]`. GitHub Actions lo sube a la rama **`catalogo`** (force push, sin historial). |
| `listas.js` | Catálogo en el navegador (`cargarCatalogo`, Cache Storage, se renueva cuando cambia `meta.json`; `buscarEnCatalogo`) y la pestaña 🧾 Listas. Se carga antes del script principal y usa sus funciones (`priceFor`, `pagosDe`, `cuponesDe`, `searchConf`…). |
| `scrape.js` | Lo corre GitHub Actions (`.github/workflows/precios.yml`, 7:17 y 13:17 AR). Baja todas las categorías y guarda versiones recortadas en `data/*.json` + `data/meta.json` + `data/dia-stock.json` (stock de las tiendas Dia de la zona). |
| `server.js` | Servidor local Node 18+ sin dependencias (`iniciar.bat`, puerto 8787). Sirve estáticos y hace de proxy `/proxy?url=` (solo hosts de Dia/Coto/Carrefour) porque Dia y Carrefour no permiten CORS. Único POST permitido: la simulación de compra de Dia (`POST_PATHS`). `/ping` responde `superscrap`. |
| `sw.js` | Service worker: network-first con caché (`superscrap-vN`); pide con `cache: "no-cache"` para que GitHub Pages (que deja guardar 10 min) no sirva versiones viejas, y al activarse no borra la caché del catálogo (`superscrap-catalogo`). **Subí la versión de `CACHE`** si cambiás archivos del shell, y agregá archivos nuevos a `SHELL`. |
| `data/` | Snapshots generados por `scrape.js` (commiteados por el bot). No editar a mano. |

## Cómo correr / probar

```bash
node server.js            # http://localhost:8787 (NO_OPEN=1 para no abrir el navegador, PORT=xxxx para otro puerto)
node scrape.js            # regenera data/*.json (requiere red)
```

No hay tests ni linter. Para verificar: `node --check` sobre `categorias.js`/`scrape.js` (y sobre el `<script>` de `index.html` extraído), y abrir la app con `server.js` revisando cada pestaña.

## Flujo de datos

1. **Orden de fuentes** (`getJSON` en `index.html`): servidor local `/proxy` → directo (Coto permite CORS, Dia no) → snapshot `data/<snap>.json` (solo categorías fijas, solo si la página se sirve por http). Cada intento tiene timeout (`FETCH_TIMEOUT`).
   - Si la página se abre con doble clic (`file://`), se busca el servidor en `LOCAL_SERVER` (`http://localhost:8787`); por eso `server.js` responde `/proxy` y `/ping` con `access-control-allow-origin: *`.
   - **No hay proxies públicos**: allorigins y corsproxy.io dejaron de andar (nov 2026: timeout / piden API key) y los alternativos probados (codetabs, thingproxy, cors.eu.org, cors-anywhere…) también fallan. Sin servidor local, Dia solo sale de los snapshots y la búsqueda libre no puede traer Dia.
   - Coto bloquea a Chrome headless por user-agent: al probar con `--headless`, pasá `--user-agent` de un Chrome normal.
2. **Dia**: API VTEX pública `diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search` — por categoría (`/frescos/leches/...?map=c,c,c`) o por texto (`?ft=...`), máx. 50 resultados (`_from=0&_to=49`), `O=OrderByPriceASC`. Promos en `commertialOffer.Teasers` ("Llevando 2 a $X", "2do al 70%", "3x2", "%") → `parseDiaTeaser`.
3. **Coto**: JSON Endeca `www.coto.com.ar/sitios/cdigi/categoria/...?format=json` — por categoría (`/_/N-xxxx`) o por texto (`?Ntt=...`). Los productos están anidados: `cotoRecords` busca el primer objeto con `@type` y `records`. Precio en `sku.activePrice`, promos en `product.dtoDescuentos` (JSON string, `precioDesc` = precio por unidad con promo).
   **Carrefour**: también VTEX (`www.carrefour.com.ar`, sin CORS). Teasers tipo `PROMO-2do al 50% Max 8 unidades Combinable ...` → `cleanCarrefourTeaser` los recorta a "2do al 50%" e ignora los de Tarjeta/Cuenta Digital Carrefour. `ListPrice` > `Price` = oferta.
4. Se normaliza todo a `{ store, id, sku, name, brand, url, img, size, unit, shelf, list, promos[], hasPromo, tipo, cat, stock }` (`normVtex(p, "dia"|"carrefour")` / `normCoto`). `STORES = ["coto","dia","carrefour"]` define el orden de columnas.
5. **Filtro por categoría** (`matchesCat`): sobre el nombre normalizado (minúsculas, sin acentos) — todos los `include` deben matchear, `exclude` descarta, `brand` (opcional) contra marca o nombre. Coto además puede filtrar por `cotoCategory`.
6. **Precio** (`priceFor`): `one` = pagando 1 unidad ese día; `best` = mejor precio c/u aprovechando promos. Reglas:
   - Descuento con medio de pago (`pagoPara`): el mayor % de las promos de ese súper que valen ese día (`dias`, `desde`/`hasta` contra la fecha del próximo día elegido), en el local u online según `S.donde`, con un medio que el usuario tiene (`S.medios`). **No se suma a una promo del producto** (2da al 50%, 2x1, "35% Dto"): se elige lo más barato entre la promo y el precio de góndola con el descuento, salvo que la promo del medio de pago sea `acumulable: true` (ej. Carrefour + Mercado Pago). Una oferta de precio rebajado (`list > shelf`) sí lo admite. Las `soloSinOferta` (Coto) no aplican a productos con promo u oferta. No se tienen en cuenta tope ni compra mínima: la compra mínima se muestra en la nota del producto ("−10% Mercado Pago (compra mín. $20.000)"); en Listas sí se calculan.
   - Ya no hay descuentos cargados a mano (antes: finde de Coto y Club Dia); `S.cotoWeekend`/`S.club` viejos se borran al cargar.
7. **Orden** (`cmp`): por precio por kg/L (`oneU`/`bestU`) usando el tamaño parseado del nombre (`parseSize`: g, kg, ml, L, packs "3 x 170 g"; los que se venden por kilo sin decir el peso, "X KG" / "x Kg." / "por kilo", cuentan como 1 kg). Productos sin tamaño conocido (ej. "x 3 Ud.") van al final, ordenados por precio del envase. En Leches, si no dice tamaño se asume 1 L y solo se aceptan envases de 0,5 a 2 L.

## Mi zona (stock por tienda)

Config en `ZONA` de `categorias.js`; el usuario marca tiendas en Configuración → Mi zona (`S.zona.on`, clave `"<store>:<id>"`) y activa "Solo con stock en mi zona" (`S.zona.only`). `p.stock` = `{ <id tienda>: true/false | unidades }`.
- **Coto**: cada producto trae `product.sDisp_<sucursal>`; `"1004"` = hay stock (así lo lee Coto Digital), `"1001"` = no. Solo ~36 sucursales (Hiper): Morón 215, Ciudadela 129, Moreno 219. Castelar (199) no se publica; en Ituzaingó no hay Coto. `scrape.js` guarda esos campos en el snapshot.
- **Dia y Carrefour (VTEX)**: cada local con "retiro en tienda" es un seller (`ardiaprodNNNN`, `carrefourarNNNN`; se listan con `/api/checkout/pub/pickup-points?geoCoordinates=long;lat`, el prefijo del id del punto es el seller). Compra simulada (`SIMULATION[store]`, POST, hasta 50 ítems, `quantity: 99`) **sin `postalCode`**: devuelve las unidades de ese local, con tope `STOCK_CAP` (Dia 24, Carrefour 50); `availability != "available"` = 0. Con código postal responde `cannotBeDelivered` (no hace envíos) y no sirve. Sin servidor local se usa `data/<súper>-stock.json`.
  - Dia: locales de Ituzaingó (2), Castelar (2) y Morón (4; Independencia 173 da casi todo 0, apagado por defecto). Williams Morris 3924 (Castelar) se sacó a pedido del usuario.
  - Carrefour: solo los Hiper que venden online son sellers (Villa Tesei 0010 —sacado a pedido del usuario—, Moreno 0021, San Justo 0012; los dos últimos apagados por defecto, así que Carrefour no filtra por stock salvo que se activen). El Hiper Ituzaingó (Ratti, 0036) y los Express solo son puntos de retiro de `carrefourar0899` y no publican stock ("no encontrado").
- Las etiquetas se agrupan por `loc` (localidad): "Castelar: 1 de 3 locales"; el detalle por local va en `title` (hover o tocar).
- `hasZonaStock`: true si alguna tienda marcada tiene; false si se sabe que ninguna; null si no se sabe (no se oculta).

## Histórico

- `scrape.js` agrega una toma a `data/historial/<cat>.json` **solo en GitHub Actions** (`GITHUB_ACTIONS=true`) o con `node scrape.js --historial`, para que las corridas locales no generen conflictos con los commits del bot. Guarda 60 días (`HIST_DIAS`).
- Formato: `{ v, productos: { "<súper>:<id>": [nombre, MARCA, súper, tamaño, unidad] }, tomas: [{ t: ISO, d: "YYYY-MM-DD" (hora AR), p: { "<súper>:<id>": [sin promo, lista, mejor c/u con promo|null, unidades de la promo|null, texto|null] } }] }`.
- Solo productos que pasan el filtro de la categoría (`matchesCat`, y en leches `cotoCategory` + envases de 0,5 a 2 L). La búsqueda libre no tiene histórico.
- "Con promo" = mínimo entre precio sin promo y la mejor promo c/u (incluye descuentos de 1 unidad de Coto como "35%Dto"). No incluye los descuentos con medios de pago.
- `historico.html` agrega por día (menor precio del día de cada producto) y por súper (menor precio por kg/L; los productos sin tamaño conocido no entran en esa comparación pero sí en "Un producto"). Respeta las marcas excluidas de la configuración de la app. Filtros (por categoría, `histFiltros:<cat>`): súper, formato (`formato(size, unit)`: "250 g", "1 L", "120 m"), marca (agrupada como `brandKey`) y texto (`-palabra` quita); aplican a todo (gráfico, tablas por día de la semana y "Un producto"). Cada opción muestra cuántos productos quedan con los demás filtros.
- Colores de los súper en el histórico validados con el script de la skill dataviz (claro: `#0a4ea2`, `#d6001c`, `#00876a`; oscuro: `#5a95ec`, `#ef4d5f`, `#1fa088`).

## Descuentos con medios de pago

- **Fuentes** (`promos.js`, ninguna es oficial):
  - Coto: `coto.com.ar/rest/model/atg/actors/cProfileActor/getPromocionesMulticanal` (JSON, CORS abierto). `promocionesSucursalesFisicas` = local, `promocionesDigitales` = online. `dias[].id`: 1 = domingo … 7 = sábado; vacío = todos. El medio sale de `descripcion` + `icono` (`logo_mercadopago.png`…).
  - Coto, promos puntuales: **no todas están en ese servicio**. Las de fin de semana que Coto publica semana a semana (ej. "DESCUENTOS SÁBADO Y DOMINGO" = 20% con Mercado Pago, "BANCO ICBC FIN DE SEMANA") solo están en los términos legales: `coto.com.ar/sitios/cdigi/terminos-descuentos?format=json` (`Main[0].content` = HTML con `.legal-card` → `.legal-header` / `.legal-body`). `promosCotoLegales` toma las de hasta 4 días (`fechasPuntuales`), con % y medio; el medio lo decide el título (`medioLegal`, el texto solo suma MODO) y se ignoran menciones en negativo ("no válido con Mercado Pago", `sinNegaciones`). Se saltean las regionales (`REGIONAL`) y las que ya están en el servicio. Coto suele publicar la del finde recién en la semana: mientras tanto se muestra como **habitual sin confirmar**.
- **Comunidad Coto**: en `product.dtoDescuentos` hay promos "+10%" con `imagenDescuento` `comunidad.png`: son solo para socios. `cotoOffer` las marca (`comunidad: true`, texto "… Comunidad Coto") y la app solo las usa si el usuario marcó "Comunidad Coto" en sus medios (`promosDe` / `promosUsables`). El histórico no las cuenta.
- **Club Dia** (`promosDiaClub`): cupón de los martes de la página `/legales` de Dia (pares `paragraph--main-question-frecuentes` / `paragraph--answer1`, título "Cupón 24/11/2026"): toda la compra, cualquier medio de pago, sin mínimo ni tope. **El legal no dice el %**: se usa 20% (`CLUBDIA_PCT`) porque es lo que comunica Dia ("cupón ClubDia 20% de cada martes"; en redes "hasta 20%"), y se muestra la aclaración (`pctFuente`). Pedido del usuario: no inventar descuentos sin fuente. Exclusiones del legal ("NO INCLUYE…") → `excluye` (leches infantiles, golosinas, vinos, carnes, mostrador); la app las reconoce por la categoría de Dia (`EXCLUYE_RX`, `excluido`; las milanesas de soja no son carne). Es `cupon: true, acumulable: true`: en `priceFor` se aplica **además** del medio de pago y sobre las promos del producto. No se toman el +60 (sin % vigente publicado), cumpleaños ni bienvenida.
- **Habituales** (`combinarHistorial` en `promos.js`): `promos.json` guarda `vistas` (promos puntuales vistas, 70 días, se acumulan entre corridas) y arma `habituales` = las que terminaron hace 7 días o menos (no las de "1°/2° fin de semana", que son mensuales), con `ultimoPct` y `pcts` vistos (Coto a veces baja el 20% a 15%). La app (`habitualesDe`) las muestra para las fechas hasta 14 días después de la última, si no hay una publicada igual: con borde punteado en Descuentos y "posible −X% (sin confirmar)" en el aviso del día. **No se aplican a los precios.**
  - Dia: la página `/medios-de-pago-y-promociones` trae las tarjetas como JSON (`"cards":[...]`, con `daysToShow`, `availableOn`, `active`, `terms`). Hay más de un bloque: se usa el **último** (el de la página de promos) y se descartan las vencidas leyendo fechas de `terms` (`parseVigencia`). %, tope y mínimo salen del texto legal.
  - Carrefour: Master Data pública `/api/dataentities/BP/search` (header `accept: application/vnd.vtex.ds.v10+json`, `_where=active=true AND active_to>…`) + `FB` (bancos, por `idBank`: ahí se ve que una promo sin nombre de medio es de Mercado Pago). `hyper/market/express` = local; `maxi` aparte (mayorista); `ecommerce` = online.
- Formato normalizado (`data/promos.json`): `{ id, super, medio, banco, pct, cuotas, dias[], local, online, tiendas, tope, minimo, desde, hasta, cuando, soloSinOferta, acumulable, resumen, legal, url }`. `banco` solo cuando hace falta otro medio además (ej. MODO desde la app de Supervielle).
- `MEDIOS` / `clasificarMedio(...textos)` en `comun.js`: catálogo y detección por regex (prioridad billetera > banco > beneficio > "todos los medios" > tarjeta). Para un medio nuevo: agregalo a `MEDIOS` (y su logo a `logos/` si hay).
- `scrape.js` la corre en cada actualización; si un súper falla, conserva sus promos anteriores vigentes. `bajarPromos` saca vencidas, sin % ni cuotas, y repetidas.
- La pestaña 💳 Descuentos (`renderPromos`) elige medios (`S.medios`, chips con logo) y lista por día desde hoy (+ "Todos los días"), filtros `S.pf` (mis medios/todos, súper, cuotas) y `S.donde`. El detalle de cada promo (texto legal) va en un `<details>`.

## Catálogo completo

- `catalogo.js`: Dia y Carrefour por categoría hoja del árbol VTEX (`/category/tree/3`, de a 50, máx. 2500 por categoría, 6 en paralelo, reintentos con espera); Coto por categoría Endeca de a 1000 (`Nrpp=1000&No=`). Solo categorías de supermercado (`SUPER[*].rx`). Solo productos con precio y disponibles (`vtexOffer`/`cotoOffer`).
- Se lee de `CATALOGO_URL` (raw.githubusercontent.com, permite CORS). Con el servidor local, si existe `./catalogo/` (gitignored, `node catalogo.js`) se usa esa.
- La búsqueda libre sin servidor local (web/celular) usa el catálogo para Dia y Carrefour (Coto sigue en vivo).
- Precios de hasta ~12 h; sin stock por local.

## Listas de compras

- `listas` / `listaSel` en localStorage (solo en el dispositivo). Ítem = `{ q, marca, tam, cant, fijos: { <súper>: <id> } }`. `q` acepta `-palabra`. `tam`: con número y unidad (500 g, 1 L) compara ese envase (±3%); si no (M, XG, blend) es una palabra que tiene que estar en el nombre (`parseTam`).
- Ítems como `<details>`: minimizados en una línea (nombre, ×cant, precio en cada súper; el más barato en verde), los más nuevos arriba; el recién agregado queda abierto (`abiertos`).
- Por súper, el usuario puede **descartar** el elegido (`descartes[s]`, pasa al siguiente) o elegir **Ninguno** (`fijos[s] = "-"`): ese súper cuenta el ítem como faltante, así no se recomienda un súper que no tiene lo que se busca (ej. el café "clásico" que es torrado aunque no lo diga).
- `candidatos`: con tamaño, el más barato; sin tamaño, el más barato por kg/L. El usuario puede fijar un producto por súper (`fijos`).
- `costoLinea`: promos por cantidad de a grupos (con 3 y "2da al 50%": 2 con promo + 1 normal). `totalSuper`: prueba cada medio de pago del día (y ninguno) y se queda con el menor total, respetando compra mínima (sobre el total), tope (`topeNum` del texto) y `soloSinOferta`; el medio de pago no se suma a promos del producto salvo `acumulable`. Después el cupón Club Dia (con exclusiones). Orden: primero los súper a los que no les falta nada, después por total.

## Búsqueda libre

- Se manda a Dia y Carrefour (`ft=`) y Coto (`Ntt=`) lo que escribió el usuario, sin las palabras con `-`.
- Después se filtra: el nombre tiene que contener **todas** las palabras (plural simple: "milanesas" → "milanesa").
- **Quitar palabras**: campo aparte ("Quitar palabras") o `-palabra` en la búsqueda (ej. `cafe cabrales -torrado`). Las `-palabras` se mueven a la lista `qExcl` (chips con ✕). Todo producto cuyo nombre tenga alguna queda fuera del análisis (rankings, veredicto y tabla), y se muestra cuántos se quitaron. Agregar o sacar palabras quitadas **no** vuelve a consultar a Dia/Coto: solo re-filtra lo que ya está cargado.
- No tiene snapshot en `data/`, así que en GitHub Pages los resultados de Dia dependen de los proxies públicos (pueden fallar). Con `server.js` funciona siempre.

## Agregar una categoría fija

1. Agregá una entrada en `CATEGORIAS` de `categorias.js` (`label`, `emoji`, `unit`, `dia[]`, `coto`, `carrefour[]`, `include[]`, `exclude`, `brand?`, `snap`). Probá antes las búsquedas en las APIs para ajustar los regex (sin tildes, en minúsculas).
2. `snap` = `{ dia: [un nombre por URL], coto: "nombre", carrefour: [un nombre por URL] }`.
3. Corré `node scrape.js` para generar los `data/*.json` nuevos. La pestaña aparece sola.

## Filtro por súper y por marca

En "Todos los productos" hay chips por súper (`storeSel`, multi-selección, se guarda en `allStores` para todas las pestañas); las marcas y sus cantidades son las de los súper elegidos.
En "Todos los productos" hay chips por marca (con cantidad), multi-selección; "Todas" limpia. Solo filtra esa tabla, no los rankings ni el veredicto. Las marcas se agrupan con `brandKey` (sin acentos, sin "La/El/Los/Las" al principio) porque Dia y Coto las escriben distinto. La selección se guarda por categoría (`brands` / `brands:<cat>`) y se limpia al hacer una búsqueda nueva.

## Estado en el navegador (localStorage, prefijo `superscrap:`)

- `settings` (medios de pago `medios`, `donde`, filtros de Descuentos `pf`, zona, filtros), `promos` (último `data/promos.json`), `cat` (pestaña actual), `query` (última búsqueda, solo palabras a buscar), `queryExcl` (palabras quitadas).
- Caché de productos por categoría: `products` / `fetchedAt` para leches (claves históricas) y `products:<cat>` / `fetchedAt:<cat>` para el resto (incluye `busqueda`).
- Los productos guardados de versiones viejas tenían `liters`; `loadProducts` los migra a `size`/`unit`.

## Convenciones

- Sin dependencias ni paso de build: JS plano en el navegador y Node 18+ (usa `fetch` nativo).
- Escapá siempre con `esc()` lo que venga de las APIs antes de meterlo en `innerHTML`.
- Si cambiás campos que usa la app de Coto o Dia, revisá `COTO_KEEP` / `trimDia` en `scrape.js` para que los snapshots los incluyan.
- `server.js` solo hace proxy a los hosts de `ALLOWED_HOSTS`; no lo abras a cualquier URL.
