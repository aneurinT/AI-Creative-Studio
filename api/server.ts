/**
 * local server entry file, for local development
 */
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