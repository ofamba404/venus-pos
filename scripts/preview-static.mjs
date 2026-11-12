import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

http
  .createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    rel = rel.replace(/^\/+/, '');
    let file = path.join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file) && (rel === 'next' || rel.startsWith('next/'))) {
      file = path.join(root, 'next', 'index.html');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end(`missing ${rel}`);
        return;
      }
      const ext = path.extname(file);
      const headers = {
        'content-type': types[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
      };
      const compressible = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.svg' || ext === '.json' || ext === '.webmanifest';
      const accept = String(req.headers['accept-encoding'] || '');
      if (compressible && /\bgzip\b/.test(accept)) {
        zlib.gzip(data, (zipErr, zipped) => {
          if (zipErr) {
            res.writeHead(200, headers);
            res.end(data);
            return;
          }
          res.writeHead(200, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' });
          res.end(zipped);
        });
        return;
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  })
  .listen(4174, '127.0.0.1', () => {
    console.log('preview static 4174', root);
  });
