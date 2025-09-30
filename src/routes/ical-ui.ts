import express from 'express';
import dataRouter from './ical/data';
import guestsRouter from './ical/guests';
import notesRouter from './ical/notes';
import uiRouter from './ical/ui';
import propertiesRouter from './ical/properties';
import summaryRouter from './ical/summary';

const router = express.Router();

// Use the sub-routers
router.use(dataRouter);
router.use(guestsRouter);
router.use(notesRouter);
router.use(uiRouter);
router.use(propertiesRouter);
router.use(summaryRouter);

export default router;
