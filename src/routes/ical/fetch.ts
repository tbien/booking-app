import express from 'express';
import { ICalExportService } from '../../services/ICalExportService';
import { PropertyConfig } from '../../models/PropertyConfig';

const router = express.Router();
const icalService = new ICalExportService();

// Helper to parse YYYY-MM-DD to local Date start/end
const parseLocalDate = (dateStr: string, isEnd = false): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (isEnd) return new Date(y, m - 1, d, 23, 59, 59, 999);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

router.get('/fetch', async (req, res) => {
  try {
    const fromStr = (req.query.from as string) || '';
    const toStr = (req.query.to as string) || '';
    const sortBy = (req.query.sortBy as 'start' | 'end') || 'end';
    const groupId = (req.query.groupId as string) || '';
    const propertyNames = (req.query.propertyNames as string) || '';

    if (!fromStr || !toStr) {
      return res.status(400).json({ success: false, error: 'from and to parameters are required' });
    }

    // Validate date format (basic)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromStr) || !dateRegex.test(toStr)) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const from = parseLocalDate(fromStr, false);
    const to = parseLocalDate(toStr, true);

    // Build property filter
    let propertyQuery: any = {};
    if (groupId) propertyQuery.groupId = groupId;
    if (propertyNames) {
      const names = propertyNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length > 0) propertyQuery.name = { $in: names };
    }

    const properties = await PropertyConfig.find(propertyQuery).lean();
    const icalProperties = properties.map((p: any) => ({ name: p.name, icalUrl: p.icalUrl }));

    const { reservations, summary } = await icalService.fetchReservationsInRange({
      properties: icalProperties,
      from,
      to,
      sortBy,
    });

    // Return parsed iCal reservations directly (no DB writes)
    res.json({ success: true, rows: reservations, summary });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

export default router;
