const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 5173;
const ROOT = process.cwd();

const clients = new Set();
let reloadTimer = null;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    const payload = 'data: reload\n\n';
    for (const res of clients) {
      res.write(payload);
    }
  }, 80);
}

function safeResolve(urlPath) {
  const cleaned = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  const absPath = path.resolve(ROOT, cleaned);
  if (absPath === ROOT) return absPath;
  if (absPath.startsWith(ROOT + path.sep)) return absPath;
  return null;
}

function injectLiveReload(html) {
  const snippet = `\n<script>\n(() => {\n  const es = new EventSource('/__livereload');\n  let pending = false;\n  es.onmessage = () => {\n    if (pending) return;\n    pending = true;\n    setTimeout(() => {\n      pending = false;\n      window.location.reload();\n    }, 50);\n  };\n  es.onerror = () => {\n    // keep trying silently\n  };\n})();\n</script>\n`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}</body>`);
  }
  return html + snippet;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let filePath = safeResolve(urlPath || '/');
  if (!filePath) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      let body = data;

      if (ext === '.html') {
        body = Buffer.from(injectLiveReload(data.toString('utf8')), 'utf8');
      }

      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(body);
    });
  });
});

try {
  fs.watch(ROOT, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const normalized = String(filename).replace(/\\/g, '/');
    if (normalized.startsWith('node_modules/') || normalized.includes('/.git/')) return;
    scheduleReload();
  });
} catch (err) {
  console.error('File watching failed:', err.message);
}

server.listen(PORT, HOST, () => {
  console.log(`Dev server running at http://${HOST}:${PORT}`);
  console.log('Live reload enabled.');
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
