// Optional development-only static server. GitHub Pages needs no server or build step.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.md': 'text/plain' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Serve both root and a project subpath to verify GitHub Pages URL compatibility.
    const route = decodeURIComponent(url.pathname).replace(/^\/AutoCut(?=\/|$)/, '') || '/';
    let path = resolve(root, '.' + route);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 5173), '0.0.0.0', () => console.log('AutoCut static preview ready on port ' + (process.env.PORT || 5173)));
