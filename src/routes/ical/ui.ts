import express from 'express';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// add routes for serving the UI

router.get('/', (req, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'ui', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('UI not found');
});

router.get('/config', (req, res) => {
  const configPath = path.join(process.cwd(), 'public', 'ui', 'config.html');
  if (fs.existsSync(configPath)) res.sendFile(configPath);
  else res.status(404).send('Config UI not found');
});

export default router;
