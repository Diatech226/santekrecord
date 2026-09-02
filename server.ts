import express from 'express';
import http from 'http';
import path from 'path';
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

function openBrowser(url: string) {
  if (process.env.NODE_ENV === 'production' || process.env.NO_OPEN === 'true') return;
  const command = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, error => { if (error) console.log(`Open ${url} manually in your browser.`); });
}

// This process serves only the React application. Audio, settings, recordings,
// diagnostics, and /ws/monitor are exclusively owned by FastAPI on port 8000.
async function start() {
  const server = http.createServer(app);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  server.listen(PORT, HOST, () => {
    const browserHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
    const url = `http://${browserHost}:${PORT}`;
    console.log(`Frontend ready at ${url}; real audio API: http://127.0.0.1:8000`);
    openBrowser(url);
  });
}

start().catch(error => { console.error(error); process.exitCode = 1; });
