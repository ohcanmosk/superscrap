// SuperScrap - servidor local mínimo (sin dependencias, Node 18+)
// Sirve index.html y hace de puente (proxy) hacia Dia/Coto, porque Dia no permite
// pedidos directos desde el navegador (CORS).
// Uso:  node server.js   ->  http://localhost:8787

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT) || 8787;
const ALLOWED_HOSTS = new Set([
  "diaonline.supermercadosdia.com.ar",
  "www.coto.com.ar",
  "www.cotodigital.com.ar",
  "www.carrefour.com.ar",
]);
// Únicos POST permitidos: la compra simulada de Dia y Carrefour, que devuelve el stock de un local (no compra nada).
const POST_PATHS = new Set([
  "diaonline.supermercadosdia.com.ar/api/checkout/pub/orderForms/simulation",
  "www.carrefour.com.ar/api/checkout/pub/orderForms/simulation",
]);
const readBody = req => new Promise((ok, fail) => {
  const parts = []; let n = 0;
  req.on("data", c => { n += c.length; if (n > 1e6) { fail(new Error("pedido muy grande")); req.destroy(); } else parts.push(c); });
  req.on("end", () => ok(Buffer.concat(parts))); req.on("error", fail);
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  // CORS abierto para /proxy y /ping: así index.html abierto con doble clic (file://) puede usar este servidor.
  if (u.pathname === "/proxy" || u.pathname === "/ping") res.setHeader("access-control-allow-origin", "*");
  if (req.method === "OPTIONS" && u.pathname === "/proxy") {
    res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" });
    return res.end();
  }

  if (u.pathname === "/proxy") {
    let target;
    try { target = new URL(u.searchParams.get("url")); } catch { target = null; }
    const isPost = req.method === "POST";
    if (!target || target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname) ||
        (isPost && !POST_PATHS.has(target.hostname + target.pathname))) {
      res.writeHead(400, { "content-type": "text/plain" });
      return res.end("URL no permitida");
    }
    try {
      const r = await fetch(target, {
        method: isPost ? "POST" : "GET",
        body: isPost ? await readBody(req) : undefined,
        headers: { "user-agent": "Mozilla/5.0 (SuperScrap)", accept: "application/json",
          ...(isPost ? { "content-type": "application/json" } : {}) },
        redirect: "follow",
      });
      const body = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, {
        "content-type": r.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      });
      return res.end(body);
    } catch (e) {
      res.writeHead(502, { "content-type": "text/plain" });
      return res.end("Error al consultar: " + e.message);
    }
  }

  if (u.pathname === "/ping") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("superscrap");
  }

  // Archivos estáticos (index, manifest, sw, íconos, data/*.json)
  const rel = decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname);
  const file = path.normalize(path.join(__dirname, rel));
  const ext = path.extname(file);
  if (file.startsWith(__dirname + path.sep) && TYPES[ext] && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": TYPES[ext], "cache-control": "no-store" });
    return fs.createReadStream(file).pipe(res);
  }

  res.writeHead(404);
  res.end();
});
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png",
};

// Si el puerto ya está ocupado (típicamente otra ventana de iniciar.bat abierta), avisar en vez de cerrarse sin decir nada.
server.on("error", async e => {
  if (e.code !== "EADDRINUSE") throw e;
  let isOld = false;
  try { isOld = (await (await fetch(`http://localhost:${PORT}/ping`)).text()) === "superscrap"; } catch {}
  console.error(isOld
    ? `
Ya hay un SuperScrap abierto en el puerto ${PORT} (otra ventana de iniciar.bat, quizás de una versión vieja).
` +
      `Cerrá esa ventana (o el proceso node.exe) y volvé a ejecutar iniciar.bat.`
    : `
El puerto ${PORT} está ocupado por otro programa. Probá con: set PORT=8788 && node server.js`);
  process.exit(1);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`SuperScrap corriendo en ${url}  (Ctrl+C para cerrar)`);
  const lan = Object.values(require("os").networkInterfaces()).flat()
    .filter(i => i && i.family === "IPv4" && !i.internal && /^(192\.168|10\.)/.test(i.address));
  lan.forEach(i => console.log(`Desde el celular (misma WiFi): http://${i.address}:${PORT}`));
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === "win32" ? `start "" "${url}"` :
                process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
