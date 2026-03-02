import express from 'express';
import ical, { ICalEventStatus, ICalEventTransparency } from 'ical-generator';
import { Property } from '../../models/Property';
import { Booking } from '../../models/Booking';

const router = express.Router();

// GET /ical/export/:exportToken — public, no auth required
// Booking.com and Airbnb subscribe to this URL
router.get('/export/:exportToken', async (req, res) => {
  try {
    const property = await Property.findOne({ exportToken: req.params.exportToken }).lean();
    if (!property) {
      return res.status(404).send('Calendar not found');
    }

    // Export only manual blocks — do NOT re-export iCal bookings fetched from
    // Booking.com / Airbnb to avoid duplicates when both this feed and the
    // platform's own feed are imported into the same external calendar.
    const bookings = await Booking.find({
      propertyId: String((property as any)._id),
      isManual: true,
      manualType: 'block',
      cancellationStatus: { $exists: false },
    }).lean();

    const calendar = ical({
      name: (property as any).displayName,
      prodId: { company: 'booking-app', product: 'calendar' },
    });

    for (const booking of bookings) {
      calendar.createEvent({
        id: (booking as any).uid,
        start: new Date((booking as any).start),
        end: new Date((booking as any).end),
        summary: 'Not available',
        description: (booking as any).blockReason || '',
        status: ICalEventStatus.CONFIRMED,
        transparency: ICalEventTransparency.OPAQUE,
      });
    }

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${(property as any).name}.ics"`);
    res.send(calendar.toString());
  } catch (e: any) {
    res.status(500).send('Internal Server Error');
  }
});

export default router;
