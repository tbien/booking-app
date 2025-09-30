import express from 'express';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { DEFAULT_PROPERTY_NAME } from './shared';

const router = express.Router();

router.get('/summary/current-month', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const bookings = await Booking.find({
      start: { $gte: startOfMonth, $lte: endOfMonth },
    }).lean();
    const properties = await PropertyConfig.find().lean();
    const propMap = new Map(properties.map((p) => [p.name, p.cleaningCost || 0]));
    const uniqueProperties = new Set(bookings.map((b) => b.propertyName || DEFAULT_PROPERTY_NAME));
    let total = 0;
    uniqueProperties.forEach((prop) => {
      total += propMap.get(prop) || 0;
    });
    res.json({ success: true, total });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

export default router;
