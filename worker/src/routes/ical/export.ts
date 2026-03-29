import { Hono } from 'hono';
import ical, { ICalEventStatus, ICalEventTransparency } from 'ical-generator';
import { Property } from '../../../../src/models/Property';
import { Booking } from '../../../../src/models/Booking';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

// GET /ical/export/:exportToken — public, no auth required
router.get('/export/:exportToken', async (c) => {
  try {
    const property = await Property.findOne({
      exportToken: c.req.param('exportToken'),
    }).lean();
    if (!property) {
      return c.text('Calendar not found', 404);
    }

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

    return new Response(calendar.toString(), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${(property as any).name}.ics"`,
      },
    });
  } catch (e: any) {
    return c.text('Internal Server Error', 500);
  }
});

export default router;
