import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.static(path.join(__dirname, 'dist')));

app.use('/images', express.static(path.join(__dirname, 'api', 'public', 'images')));
app.use('/uploads', express.static(path.join(__dirname, 'api', 'public', 'uploads')));

import('./api/dist/app.js').then(({ default: apiApp }) => {
  app.use('/api', apiApp);
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
  
  app.listen(PORT, () => {
    console.log(`AI Creative Studio Server running on http://localhost:${PORT}`);
    console.log(`Frontend: http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api`);
    console.log(`Images: http://localhost:${PORT}/images`);
    console.log(`Uploads: http://localhost:${PORT}/uploads`);
  });
}).catch(err => {
  console.error('Failed to load API:', err);
  process.exit(1);
});