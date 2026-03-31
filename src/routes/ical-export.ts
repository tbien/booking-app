import { Router } from 'express';
import { CalendarExportService } from '../services/CalendarExportService';

const router = Router();
const calendarExport = new CalendarExportService();

router.get('/export/:exportToken', async (req, res) => {
  try {
    const result = await calendarExport.generateFeed(req.params.exportToken);
    if (!result) return res.status(404).send('Calendar not found');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.icsData);
  } catch (e: any) {
    res.status(500).send('Internal Server Error');
  }
});

export default router;
