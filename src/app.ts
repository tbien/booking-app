import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import icalRouter from './routes/ical-ui';
import icalSummaryRoutes from './routes/ical/summary';
import icalPropertiesRoutes from './routes/ical/properties';
import icalGuestsRoutes from './routes/ical/guests';
import icalNotesRoutes from './routes/ical/notes';
import icalDataRoutes from './routes/ical/data';
import icalUiApiRoutes from './routes/ical/ui';
import icalGroupsRoutes from './routes/ical/groups';

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
app.use('/ical', icalSummaryRoutes);
app.use('/ical', icalPropertiesRoutes);
app.use('/ical', icalGuestsRoutes);
app.use('/ical', icalNotesRoutes);
app.use('/ical', icalDataRoutes);
app.use('/ical', icalUiApiRoutes);
app.use('/ical', icalGroupsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`🎾 booking-app on :${PORT}`));

export default app;
