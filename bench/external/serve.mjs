import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2]);
const port = Number(process.argv[3]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try { const bytes = await readFile(file); response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes); }
  catch { response.writeHead(404).end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
process.once('SIGTERM', () => server.close(() => process.exit(0)));
