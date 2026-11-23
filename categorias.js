// SuperScrap - categorías de productos y "mi zona" (compartido entre index.html y scrape.js).
// Cada categoría define de dónde se bajan los productos de Dia, Coto y Carrefour y qué filtros
// de nombre se aplican. Los filtros se evalúan sobre el nombre normalizado
// (minúsculas, sin acentos), así que escribí los regex sin tildes.
//
// Campos:
//   label, emoji     → nombre completo (título) y emoji.
//   tab              → nombre corto para la pestaña (si no está, se usa label).
//   unit             → "L", "kg" o "m": unidad para comparar precio (por litro / kilo / metro).
//   medida           → (opcional) "metros": el tamaño se lee como metros × rollos (papel higiénico).
//   porDefecto       → (opcional) tamaño que se asume si el nombre no lo dice (leches: 1 L).
//   dia, carrefour   → listas de URLs de la API VTEX (categoría o búsqueda ft=).
//   coto             → URL JSON Endeca de Coto (categoría o búsqueda Ntt=).
//   include          → lista de regex que el nombre TIENE que cumplir (todas).
//   exclude          → regex que, si matchea el nombre, descarta el producto.
//   brand            → (opcional) regex que tiene que cumplir la marca o el nombre.
//   snap             → nombres de los archivos data/*.json que guarda scrape.js:
//                      { dia: [uno por URL], coto: "...", carrefour: [uno por URL] }.

(function (root) {
  const DIA = "https://diaonline.supermercadosdia.com.ar";
  const COTO = "https://www.coto.com.ar/sitios/cdigi/categoria";
  const CARREFOUR = "https://www.carrefour.com.ar";
  const vtexSearch = base => q => `${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=49&O=OrderByPriceASC`;
  const diaSearch = vtexSearch(DIA);
  const carSearch = vtexSearch(CARREFOUR);
  const cotoSearch = q => `${COTO}?Ntt=${encodeURIComponent(q)}&Nrpp=300&format=json`;
  const vtexCat = (base, p) => `${base}/api/catalog_system/pub/products/search/${p}?map=c,c,c&_from=0&_to=49&O=OrderByPriceASC`;

  const CATEGORIAS = {
    leche: {
      label: "Leches", tab: "Leches", emoji: "🥛", unit: "L", porDefecto: 1,
      dia: [vtexCat(DIA, "frescos/leches/leches-enteras"), vtexCat(DIA, "frescos/leches/leches-descremadas")],
      coto: COTO + "/catalogo-frescos-l%C3%A1cteos-leches/_/N-zpvqr7?Nrpp=300&format=json",
      cotoFallback: cotoSearch("leche"),
      cotoCategory: /^leches (enteras|descremadas|reducidas)/,
      carrefour: [vtexCat(CARREFOUR, "lacteos-y-productos-frescos/leches/leches-enteras"),
                  vtexCat(CARREFOUR, "lacteos-y-productos-frescos/leches/leches-descremadas")],
      include: [],
      exclude: /chocolat|saboriz|polvo|condensad|infantil|fermentad|cafe|vegetal|soja|almendra|avena|dulce de leche|crema/,
      snap: { dia: ["dia-enteras", "dia-descremadas"], coto: "coto", carrefour: ["leche-carrefour-enteras", "leche-carrefour-descremadas"] },
    },
    cafe: {
      label: "Café molido", tab: "Café", emoji: "☕", unit: "kg",
      dia: [diaSearch("cafe molido")],
      coto: cotoSearch("cafe molido"),
      carrefour: [carSearch("cafe molido")],
      // Solo café que dice "tostado" en el nombre (o marcas que solo venden tostado): muchos
      // "Café Molido ... Intenso" sin aclarar son torrados (ej. Morenita Intenso = "Torrado Intenso" en Coto).
      include: [/caf/, /molid/, /tostad|cafe martin|seattle|happy day/],
      // Nada de torrado (ni "torrado suave"), ni cápsulas, saquitos, instantáneo o cafeteras.
      exclude: /torrad|capsul|saquito|instant|soluble|cafetera/,
      snap: { dia: ["cafe-dia"], coto: "cafe-coto", carrefour: ["cafe-carrefour"] },
    },
    atun: {
      label: "Atún en lomitos", tab: "Atún", emoji: "🐟", unit: "kg",
      dia: [diaSearch("atun")],
      coto: cotoSearch("atun"),
      carrefour: [carSearch("atun lomitos")],
      include: [/atun/, /lomit|lomos/],
      exclude: /desmenuz|rallad|ensalada|pate|mayonesa|croqueta|pionono|gato|perro/,
      snap: { dia: ["atun-dia"], coto: "atun-coto", carrefour: ["atun-carrefour"] },
    },
    milasoja: {
      label: "Milanesas de soja Granja del Sol", tab: "Milanesas soja", emoji: "🌱", unit: "kg",
      dia: [diaSearch("milanesa soja")],
      coto: cotoSearch("milanesa soja"),
      carrefour: [carSearch("milanesa soja granja del sol")],
      include: [/milanesa/, /soja/],
      brand: /granja del/,
      exclude: null,
      snap: { dia: ["milasoja-dia"], coto: "milasoja-coto", carrefour: ["milasoja-carrefour"] },
    },
    // Papel higiénico: se compara el precio por metro (metros por rollo × rollos).
    // Solo entran los que dicen en el nombre si son hoja simple o doble hoja ("S/H", "D/H" en Coto).
    papelsimple: {
      label: "Papel higiénico hoja simple", tab: "Papel simple", emoji: "🧻", unit: "m", medida: "metros",
      dia: [diaSearch("papel higienico")],
      coto: cotoSearch("papel higienico"),
      carrefour: [carSearch("papel higienico"), carSearch("papel higienico").replace("_from=0&_to=49", "_from=50&_to=99")],
      include: [/papel|p\.\s*higien/, /higien/, /simple|s\/h/],
      exclude: /doble|d\/h|triple|porta|palito|humed|toallit|cocina|servillet/,
      snap: { dia: ["papelsimple-dia"], coto: "papelsimple-coto", carrefour: ["papelsimple-carrefour", "papelsimple-carrefour-2"] },
    },
    papeldoble: {
      label: "Papel higiénico doble hoja", tab: "Papel doble", emoji: "🧻", unit: "m", medida: "metros",
      dia: [diaSearch("papel higienico")],
      coto: cotoSearch("papel higienico"),
      carrefour: [carSearch("papel higienico"), carSearch("papel higienico").replace("_from=0&_to=49", "_from=50&_to=99")],
      // "doble textura" (Felpita) no es doble hoja.
      include: [/papel|p\.\s*higien/, /higien/, /doble hoja|hoja doble|d\/h/],
      exclude: /simple|s\/h|triple|textura|porta|palito|humed|toallit|cocina|servillet/,
      snap: { dia: ["papeldoble-dia"], coto: "papeldoble-coto", carrefour: ["papeldoble-carrefour", "papeldoble-carrefour-2"] },
    },
  };

  // Búsqueda libre: misma lógica, pero las URLs se arman con lo que escribe el usuario.
  const buscar = q => ({ dia: [diaSearch(q)], coto: cotoSearch(q), carrefour: [carSearch(q)] });

  // "Mi zona": locales cuyo stock se puede consultar (Ituzaingó, Castelar, Morón y alrededores).
  // loc = localidad (las etiquetas de stock se agrupan por localidad).
  // - Coto: cada producto trae product.sDisp_<sucursal>; "1004" = hay stock (así lo lee Coto Digital).
  //   Coto solo publica ~36 sucursales (Hiper): Castelar (199) no está y en Ituzaingó no hay Coto.
  // - Dia y Carrefour (VTEX): cada local con retiro en tienda es un "seller". Una compra simulada
  //   SIN código postal contra ese seller devuelve las unidades que tiene (Dia tope 24, Carrefour tope 50).
  //   Carrefour solo tiene sellers para los Hiper que venden online: el Hiper Ituzaingó (Ratti) y los
  //   Express no publican stock.
  //   Sacados a pedido del usuario (le quedan lejos): Dia Castelar Williams Morris 3924 (ardiaprod5331)
  //   y Carrefour Hiper Villa Tesei (carrefourar0010).
  const ZONA = {
    coto: [
      { id: "215", loc: "Morón", label: "Coto Morón", detalle: "Hiper, Gral. J. J. Valle 51", on: true },
      { id: "129", loc: "Ciudadela", label: "Coto Ciudadela", detalle: "Hiper, Comesaña 4056", on: false },
      { id: "219", loc: "Moreno", label: "Coto Moreno", detalle: "Hiper, Av. Victorica 660", on: false },
    ],
    dia: [
      { id: "ardiaprod1007", loc: "Ituzaingó", label: "Dia Ituzaingó", detalle: "Cnel. Brandsen 1957", on: true },
      { id: "ardiaprod1027", loc: "Ituzaingó", label: "Dia Ituzaingó", detalle: "Fray Luis Beltrán 2269", on: true },
      { id: "ardiaprod1011", loc: "Castelar", label: "Dia Castelar", detalle: "Av. Estanislao Zeballos 3028", on: true },
      { id: "ardiaprod1026", loc: "Castelar", label: "Dia Castelar", detalle: "Gob. Inocencio Arias 2983", on: true },
      { id: "ardiaprod1035", loc: "Morón", label: "Dia Morón", detalle: "Int. Agüero 935", on: true },
      { id: "ardiaprod5589", loc: "Morón", label: "Dia Morón", detalle: "Av. Rivadavia 17980", on: true },
      { id: "ardiaprod5544", loc: "Morón", label: "Dia Morón", detalle: "Av. Rivadavia 18362", on: true },
      // Da casi todo en 0: parece no hacer retiros online (no refleja su góndola).
      { id: "ardiaprod98", loc: "Morón", label: "Dia Morón", detalle: "Independencia 173 (casi siempre figura sin stock)", on: false },
    ],
    carrefour: [
      { id: "carrefourar0021", loc: "Moreno", label: "Carrefour Hiper Moreno", detalle: "Av. Gaona y Graham Bell", on: false },
      { id: "carrefourar0012", loc: "San Justo", label: "Carrefour Hiper San Justo", detalle: "Av. Don Bosco 2680", on: false },
    ],
  };
  // Compra simulada (no compra nada): devuelve cuántas unidades puede vender cada local.
  const SIMULATION = {
    dia: DIA + "/api/checkout/pub/orderForms/simulation?sc=1",
    carrefour: CARREFOUR + "/api/checkout/pub/orderForms/simulation?sc=1",
  };
  const STOCK_CAP = { dia: 24, carrefour: 50 }; // máximo por producto que devuelve cada súper

  const api = { CATEGORIAS, ZONA, SIMULATION, STOCK_CAP, buscar, diaSearch, cotoSearch, carSearch };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SuperScrapCats = api;
})(this);
