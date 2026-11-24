// Service worker: permite instalar la app y abrirla sin conexión (con los últimos datos guardados).
// La página y data/*.json se piden primero a la red; si no hay red, se usa la copia en caché.
// Se pide con cache "no-cache": el navegador revalida con GitHub Pages (que deja guardar 10 min),
// así una versión nueva se ve al recargar una vez.
const CACHE = "superscrap-v28";
const SHELL = ["./", "index.html", "historico.html", "categorias.js", "comun.js", "listas.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  // Se borran solo las versiones viejas de la app (el catálogo, "superscrap-catalogo", se conserva).
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => /^superscrap-v\d+$/.test(k) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith("/proxy")) return;
  e.respondWith(
    fetch(new Request(e.request, { cache: "no-cache" })).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
