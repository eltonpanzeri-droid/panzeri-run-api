// Servidor web LOCAL de validacao (so' Node, sem dependencias): serve o app web exportado e repassa /api/* para a API local, igual ao nginx de producao.
// Uso: node servidor-web.cjs <pasta-do-app-exportado> [porta-web=8099] [porta-api=3333]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '');
const webPort = Number(process.argv[3] || 8099);
const apiPort = Number(process.argv[4] || 3333);
if (!process.argv[2] || !fs.existsSync(path.join(root, 'index.html'))) {
  console.error('Informe a pasta do app web exportado (com index.html).');
  process.exit(1);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json' };

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const upstream = http.request({ host: '127.0.0.1', port: apiPort, path: req.url.slice(4), method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end('API local fora do ar'); });
    req.pipe(upstream);
    return;
  }
  const clean = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, clean);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html'); // fallback de SPA
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(webPort, '0.0.0.0', () => console.log(`App web de teste em http://0.0.0.0:${webPort} (API em 127.0.0.1:${apiPort})`));
