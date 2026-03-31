import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import { config } from './config';
import { initDatabase } from './startup/database';
import { sessionMiddleware } from './middleware/session';
import { apiNotFound, globalErrorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import icalExportRoutes from './routes/ical-export';
import v1Routes from './routes/v1';

const app = express();

// ── Core middleware ──────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
if (config.nodeEnv !== 'test') app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sessionMiddleware);

// ── Database + sync scheduler ────────────────────────────────────────────────
initDatabase();

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/', authRoutes);
app.use('/ical', icalExportRoutes);
app.use('/api/v1', v1Routes);
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Error handling ───────────────────────────────────────────────────────────
app.all('/api/*', apiNotFound);
app.use(globalErrorHandler);

// ── Vue SPA static files ─────────────────────────────────────────────────────
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(Number(config.port), '0.0.0.0', () => console.log(`🎾 booking-app on :${config.port}`));

export default app;
