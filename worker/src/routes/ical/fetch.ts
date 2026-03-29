import { Hono } from 'hono';
import { ICalExportService } from '../../services/ICalExportService';
import { PropertyConfig } from '../../../../src/models/PropertyConfig';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();
const icalService = new ICalExportService();

const parseLocalDate = (dateStr: string, isEnd = false): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (isEnd) return new Date(y, m - 1, d, 23, 59, 59, 999);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

router.get('/fetch', async (c) => {
  try {
    const fromStr = c.req.query('from') || '';
    const toStr = c.req.query('to') || '';
    const sortBy = (c.req.query('sortBy') as 'start' | 'end') || 'end';
    const groupId = c.req.query('groupId') || '';
    const propertyNames = c.req.query('propertyNames') || '';

    if (!fromStr || !toStr) {
      return c.json({ success: false, error: 'from and to parameters are required' }, 400);
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromStr) || !dateRegex.test(toStr)) {
      return c.json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }, 400);
    }

    const from = parseLocalDate(fromStr, false);
    const to = parseLocalDate(toStr, true);

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

    return c.json({ success: true, rows: reservations, summary });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Błąd' }, 500);
  }
});

export default router;
