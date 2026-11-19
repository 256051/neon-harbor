// Neon Harbor — a tiny static file server for local testing only.
// Serves the repository root on a local port; nothing here ships in the entry.
//
//   node serve.ts            -> http://localhost:8901/
//   node serve.ts --port 8080

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8901;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let rel = normalize(urlPath).replace(/^[/\\]+/, '');
    if (rel === '') rel = 'game/index.html';
    const file = join(process.cwd(), rel);
    if (!file.startsWith(process.cwd()) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(port, () => console.log(`Neon Harbor test server: http://localhost:${port}/`));
