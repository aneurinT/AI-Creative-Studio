/**
 * local server entry file, for local development
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 手动加载 .env 文件（tsx 在某些版本不自动加载）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dotenvPath = path.join(__dirname, '..', '.env');
try {
  if (fs.existsSync(dotenvPath)) {
    const content = fs.readFileSync(dotenvPath, 'utf-8');
    content.split('\n').forEach(line => {
      const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.+)/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim();
      }
    });
    console.log('[Server] .env 文件已加载');
  } else {
    console.log('[Server] .env 文件未找到，请创建 .env 文件');
  }
} catch (e) { /* ok */ }

import app from './app.js';
import { createServer } from 'http';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = createServer(app);

server.on('error', (e: any) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use, trying to release...`);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
