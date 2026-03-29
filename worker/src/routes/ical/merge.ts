import { Hono } from 'hono';
import { Booking } from '../../../../src/models/Booking';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

const toLocalDateStr = (d: Date | string): string => {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const toLocalMidnight = (d: Date | string): Date => {
  const date = new Date(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const isSameDay = (a: Date, b: Date): boolean => toLocalDateStr(a) === toLocalDateStr(b);

// POST /ical/merge
router.post('/merge', async (c) => {
  try {
    const { ids } = await c.req.json<{ ids: string[] }>();

    if (!Array.isArray(ids) || ids.length !== 2) {
      return c.json({ success: false, error: 'Podaj dokładnie 2 id rezerwacji.' }, 400);
    }

    const [a, b] = await Promise.all([Booking.findById(ids[0]), Booking.findById(ids[1])]);
    if (!a || !b) {
      return c.json({ success: false, error: 'Nie znaleziono jednej lub obu rezerwacji.' }, 404);
    }
    if (String(a.propertyId) !== String(b.propertyId)) {
      return c.json(
        { success: false, error: 'Rezerwacje muszą dotyczyć tej samej nieruchomości.' },
        400,
      );
    }

    const [first, second] = a.end <= b.start ? [a, b] : [b, a];
    if (!isSameDay(first.end, second.start)) {
      return c.json(
        {
          success: false,
          error: `Rezerwacje nie sąsiadują bezpośrednio. Koniec pierwszej: ${first.end.toISOString().slice(0, 10)}, start drugiej: ${second.start.toISOString().slice(0, 10)}.`,
        },
        400,
      );
    }

    const mergedUid = `MANUAL-merge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const merged = await Booking.create({
      propertyId: first.propertyId,
      propertyName: first.propertyName,
      start: first.start,
      end: second.end,
      description: [first.description, second.description].filter(Boolean).join(' | '),
      location: first.location || second.location || '',
      uid: mergedUid,
      source: 'manual',
      guests: first.guests ?? second.guests,
      notes: [first.notes, second.notes].filter(Boolean).join(' | ') || undefined,
      isManual: true,
      manualType: 'merged',
      mergedFromIds: [String(first._id), String(second._id)],
      sourceSnapshot: [
        { uid: first.uid, source: first.source, start: first.start, end: first.end },
        { uid: second.uid, source: second.source, start: second.start, end: second.end },
      ],
    });

    return c.json({
      success: true,
      message: 'Rezerwacje zostały scalone.',
      booking: {
        id: String(merged._id),
        propertyName: merged.propertyName,
        start: merged.start,
        end: merged.end,
        isManual: true,
        manualType: 'merged',
        mergedFromIds: merged.mergedFromIds,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/split
router.post('/split', async (c) => {
  try {
    const { id, splitDate } = await c.req.json<{ id: string; splitDate: string }>();

    if (!id || !splitDate) {
      return c.json({ success: false, error: 'Podaj id rezerwacji i datę podziału.' }, 400);
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return c.json({ success: false, error: 'Nie znaleziono rezerwacji.' }, 404);
    }

    const splitD = toLocalMidnight(splitDate);
    const startD = toLocalMidnight(booking.start);
    const endD = toLocalMidnight(booking.end);

    if (splitD <= startD || splitD >= endD) {
      return c.json(
        {
          success: false,
          error: `Data podziału (${splitDate}) musi należeć do zakresu rezerwacji: po ${booking.start.toISOString().slice(0, 10)} i przed ${booking.end.toISOString().slice(0, 10)}.`,
        },
        400,
      );
    }

    const baseUid = `MANUAL-split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const snapshot = [
      { uid: booking.uid, source: booking.source, start: booking.start, end: booking.end },
    ];

    const [first, second] = await Promise.all([
      Booking.create({
        propertyId: booking.propertyId,
        propertyName: booking.propertyName,
        start: booking.start,
        end: splitD,
        description: booking.description || '',
        location: booking.location || '',
        uid: `${baseUid}-A`,
        source: 'manual',
        guests: booking.guests,
        notes: booking.notes,
        isManual: true,
        manualType: 'split',
        splitFromId: String(booking._id),
        sourceSnapshot: snapshot,
      }),
      Booking.create({
        propertyId: booking.propertyId,
        propertyName: booking.propertyName,
        start: splitD,
        end: booking.end,
        description: booking.description || '',
        location: booking.location || '',
        uid: `${baseUid}-B`,
        source: 'manual',
        guests: booking.guests,
        notes: booking.notes,
        isManual: true,
        manualType: 'split',
        splitFromId: String(booking._id),
        sourceSnapshot: snapshot,
      }),
    ]);

    return c.json({
      success: true,
      message: 'Rezerwacja została podzielona.',
      bookings: [
        { id: String(first._id), start: first.start, end: first.end },
        { id: String(second._id), start: second.start, end: second.end },
      ],
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/undo-merge
router.post('/undo-merge', async (c) => {
  try {
    const { id } = await c.req.json<{ id: string }>();
    if (!id) return c.json({ success: false, error: 'Podaj id scalonej rezerwacji.' }, 400);

    const merged = await Booking.findById(id);
    if (!merged || merged.manualType !== 'merged') {
      return c.json({ success: false, error: 'Nie znaleziono scalonej rezerwacji.' }, 404);
    }

    await Booking.findByIdAndDelete(id);
    return c.json({
      success: true,
      message: 'Scalenie cofnięte. Oryginalne rezerwacje są znów widoczne.',
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/undo-split
router.post('/undo-split', async (c) => {
  try {
    const { id } = await c.req.json<{ id: string }>();
    if (!id) return c.json({ success: false, error: 'Podaj id podzielonej rezerwacji.' }, 400);

    const splitBooking = await Booking.findById(id);
    if (!splitBooking || splitBooking.manualType !== 'split') {
      return c.json({ success: false, error: 'Nie znaleziono podzielonej rezerwacji.' }, 404);
    }

    const originalId = splitBooking.splitFromId;
    if (!originalId) {
      return c.json({ success: false, error: 'Brak informacji o oryginalnej rezerwacji.' }, 400);
    }

    await Booking.deleteMany({ splitFromId: originalId, manualType: 'split' });
    return c.json({
      success: true,
      message: 'Podział cofnięty. Oryginalna rezerwacja jest znów widoczna.',
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/resolve-conflict
router.post('/resolve-conflict', async (c) => {
  try {
    const { manualId, decision } = await c.req.json<{
      manualId: string;
      decision: 'keep' | 'remove';
    }>();

    if (!manualId || !['keep', 'remove'].includes(decision)) {
      return c.json({ success: false, error: 'Podaj manualId i decision (keep|remove).' }, 400);
    }

    if (decision === 'remove') {
      await Booking.findByIdAndUpdate(manualId, {
        $set: { cancellationStatus: 'cancelled' },
      });
      return c.json({
        success: true,
        message:
          'Ręczna rezerwacja anulowana. Dane z iCal zostaną zapisane przy kolejnej synchronizacji.',
      });
    }

    return c.json({ success: true, message: 'Ręczna rezerwacja zachowana.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default router;
