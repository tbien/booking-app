import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import icalRouter from './routes/ical-ui';

import { ICalExportService, ICalProperty } from './services/ICalExportService';
import { config } from './config';

const app = express();
const PORT = config.port;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
if (config.nodeEnv !== 'test') app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mongo
const mongoURI = config.mongoURI;
mongoose
  .connect(mongoURI as any)
  .then(() => console.log('✅ Mongo connected'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

// UI + routes

app.get('/config', (req, res) => {
  const configPath = path.join(process.cwd(), 'public', 'ui', 'config.html');
  if (fs.existsSync(configPath)) res.sendFile(configPath);
  else res.status(404).send('Config UI not found');
});

app.use('/', express.static(path.join(process.cwd(), 'public', 'ui')));
app.use('/ical', icalRouter);

// API
const icalService = new ICalExportService();

app.listen(PORT, () => console.log(`🎾 booking-app on :${PORT}`));

export default app;
