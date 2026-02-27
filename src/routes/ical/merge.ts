import express from 'express';
import { Booking } from '../../models/Booking';

const router = express.Router();

// Helper: normalize a date to YYYY-MM-DD string in local server timezone
// This correctly handles iCal dates stored as 22:00Z (= midnight CEST +2)
// and manual block dates stored as 00:00Z so they compare as the same day.
const toLocalDateStr = (d: Date | string): string => {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Returns a Date at local midnight for comparison purposes in split validation
const toLocalMidnight = (d: Date | string): Date => {
  const date = new Date(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const isSameDay = (a: Date, b: Date): boolean => toLocalDateStr(a) === toLocalDateStr(b);

// ──────────────────────────────────────────────
// POST /ical/merge
// Body: { ids: [id1, id2] }
// Merges exactly 2 adjacent bookings of the same property into 1 manual booking.
// ──────────────────────────────────────────────
router.post('/merge', async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] };

    if (!Array.isArray(ids) || ids.length !== 2) {
      return res.status(400).json({ success: false, error: 'Podaj dokładnie 2 id rezerwacji.' });
    }

    const [a, b] = await Promise.all([Booking.findById(ids[0]), Booking.findById(ids[1])]);

    if (!a || !b) {
      return res
        .status(404)
        .json({ success: false, error: 'Nie znaleziono jednej lub obu rezerwacji.' });
    }

    if (a.propertyName !== b.propertyName) {
      return res
        .status(400)
        .json({ success: false, error: 'Rezerwacje muszą dotyczyć tej samej nieruchomości.' });
    }

    // Sort so 'first' ends where 'second' starts
    const [first, second] = a.end <= b.start ? [a, b] : [b, a];

    if (!isSameDay(first.end, second.start)) {
      return res.status(400).json({
        success: false,
        error: `Rezerwacje nie sąsiadują bezpośrednio. Koniec pierwszej: ${first.end.toISOString().slice(0, 10)}, start drugiej: ${second.start.toISOString().slice(0, 10)}.`,
      });
    }

    // Create merged manual booking
    const mergedUid = `MANUAL-merge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const merged = await Booking.create({
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

    // Originals are NOT cancelled — they are hidden in the UI based on mergedFromIds.
    // This way iCal sync keeps updating them normally, and undo is just deleting the manual booking.

    return res.json({
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
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ──────────────────────────────────────────────
// POST /ical/split
// Body: { id, splitDate: "YYYY-MM-DD" }
// Splits 1 booking into 2: [start, splitDate] and [splitDate, end].
// ──────────────────────────────────────────────
router.post('/split', async (req, res) => {
  try {
    const { id, splitDate } = req.body as { id: string; splitDate: string };

    if (!id || !splitDate) {
      return res
        .status(400)
        .json({ success: false, error: 'Podaj id rezerwacji i datę podziału.' });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Nie znaleziono rezerwacji.' });
    }

    const splitD = toLocalMidnight(splitDate);
    const startD = toLocalMidnight(booking.start);
    const endD = toLocalMidnight(booking.end);

    if (splitD <= startD || splitD >= endD) {
      return res.status(400).json({
        success: false,
        error: `Data podziału (${splitDate}) musi należeć do zakresu rezerwacji: po ${booking.start.toISOString().slice(0, 10)} i przed ${booking.end.toISOString().slice(0, 10)}.`,
      });
    }

    const baseUid = `MANUAL-split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const snapshot = [
      { uid: booking.uid, source: booking.source, start: booking.start, end: booking.end },
    ];

    const [first, second] = await Promise.all([
      Booking.create({
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

    // Original is NOT cancelled — hidden in UI via splitFromId. Undo = delete split parts.

    return res.json({
      success: true,
      message: 'Rezerwacja została podzielona.',
      bookings: [
        { id: String(first._id), start: first.start, end: first.end },
        { id: String(second._id), start: second.start, end: second.end },
      ],
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ──────────────────────────────────────────────
// POST /ical/undo-merge
// Body: { id } – id of the merged (manual) booking
// Restores originals, removes merged booking.
// ──────────────────────────────────────────────
router.post('/undo-merge', async (req, res) => {
  try {
    const { id } = req.body as { id: string };
    if (!id)
      return res.status(400).json({ success: false, error: 'Podaj id scalonej rezerwacji.' });

    const merged = await Booking.findById(id);
    if (!merged || merged.manualType !== 'merged') {
      return res.status(404).json({ success: false, error: 'Nie znaleziono scalonej rezerwacji.' });
    }

    // Originals were never cancelled — just delete the manual merged booking.
    // The originals will automatically become visible again in the UI.
    await Booking.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: 'Scalenie cofnięte. Oryginalne rezerwacje są znów widoczne.',
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ──────────────────────────────────────────────
// POST /ical/undo-split
// Body: { id } – id of one of the split bookings (or the original)
// Restores original, removes both split parts.
// ──────────────────────────────────────────────
router.post('/undo-split', async (req, res) => {
  try {
    const { id } = req.body as { id: string };
    if (!id)
      return res.status(400).json({ success: false, error: 'Podaj id podzielonej rezerwacji.' });

    const splitBooking = await Booking.findById(id);
    if (!splitBooking || splitBooking.manualType !== 'split') {
      return res
        .status(404)
        .json({ success: false, error: 'Nie znaleziono podzielonej rezerwacji.' });
    }

    const originalId = splitBooking.splitFromId;
    if (!originalId) {
      return res
        .status(400)
        .json({ success: false, error: 'Brak informacji o oryginalnej rezerwacji.' });
    }

    // Original was never cancelled — just delete all split parts.
    // The original will automatically become visible again in the UI.
    await Booking.deleteMany({ splitFromId: originalId, manualType: 'split' });

    return res.json({
      success: true,
      message: 'Podział cofnięty. Oryginalna rezerwacja jest znów widoczna.',
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ──────────────────────────────────────────────
// POST /ical/resolve-conflict
// Body: { manualId, decision: 'keep' | 'remove' }
// ──────────────────────────────────────────────
router.post('/resolve-conflict', async (req, res) => {
  try {
    const { manualId, decision } = req.body as { manualId: string; decision: 'keep' | 'remove' };

    if (!manualId || !['keep', 'remove'].includes(decision)) {
      return res
        .status(400)
        .json({ success: false, error: 'Podaj manualId i decision (keep|remove).' });
    }

    if (decision === 'remove') {
      await Booking.findByIdAndUpdate(manualId, { $set: { cancellationStatus: 'cancelled' } });
      return res.json({
        success: true,
        message:
          'Ręczna rezerwacja anulowana. Dane z iCal zostaną zapisane przy kolejnej synchronizacji.',
      });
    }

    return res.json({ success: true, message: 'Ręczna rezerwacja zachowana.' });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
