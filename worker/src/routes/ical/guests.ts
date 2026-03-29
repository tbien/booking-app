import { Hono } from 'hono';
import { Booking } from '../../../../src/models/Booking';
import { guestSchema } from '../../../../src/routes/ical/shared';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

router.post('/guests', async (c) => {
  try {
    const body = await c.req.json();
    const { error, value } = guestSchema.validate(body);
    if (error) return c.json({ success: false, error: error.message }, 400);
    await Booking.updateOne({ _id: value.id }, { $set: { guests: value.guests } });
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Błąd' }, 500);
  }
});

export default router;
