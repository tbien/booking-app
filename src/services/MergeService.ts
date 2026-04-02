import { Booking } from '../models/Booking';

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

export class MergeService {
  async merge(ids: string[]) {
    if (!Array.isArray(ids) || ids.length < 2) {
      throw Object.assign(new Error('Podaj co najmniej 2 id rezerwacji.'), { status: 400 });
    }

    const bookings = await Promise.all(ids.map((id) => Booking.findById(id)));
    const missing = bookings.some((b) => !b);
    if (missing) {
      throw Object.assign(new Error('Nie znaleziono jednej lub więcej rezerwacji.'), {
        status: 404,
      });
    }

    const valid = bookings as NonNullable<(typeof bookings)[0]>[];
    const propertyId = String(valid[0].propertyId);
    if (valid.some((b) => String(b.propertyId) !== propertyId)) {
      throw Object.assign(new Error('Rezerwacje muszą dotyczyć tej samej nieruchomości.'), {
        status: 400,
      });
    }

    // Sort by start date
    valid.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // Validate each pair is adjacent (end of one = start of next)
    for (let i = 0; i < valid.length - 1; i++) {
      if (!isSameDay(valid[i].end, valid[i + 1].start)) {
        throw Object.assign(
          new Error(
            `Rezerwacje nie sąsiadują bezpośrednio. Koniec "${valid[i].description || i + 1}": ${valid[i].end.toISOString().slice(0, 10)}, start "${valid[i + 1].description || i + 2}": ${valid[i + 1].start.toISOString().slice(0, 10)}.`,
          ),
          { status: 400 },
        );
      }
    }

    const first = valid[0];
    const last = valid[valid.length - 1];

    const mergedUid = `MANUAL-merge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const merged = await Booking.create({
      propertyId: first.propertyId,
      propertyName: first.propertyName,
      start: first.start,
      end: last.end,
      description: valid
        .map((b) => b.description)
        .filter(Boolean)
        .join(' | '),
      location: valid.find((b) => b.location)?.location || '',
      uid: mergedUid,
      source: 'manual',
      guests: valid.find((b) => b.guests)?.guests,
      notes:
        valid
          .map((b) => b.notes)
          .filter(Boolean)
          .join(' | ') || undefined,
      isManual: true,
      manualType: 'merged',
      mergedFromIds: valid.map((b) => String(b._id)),
      sourceSnapshot: valid.map((b) => ({
        uid: b.uid,
        source: b.source,
        start: b.start,
        end: b.end,
      })),
    });

    return {
      id: String(merged._id),
      propertyName: merged.propertyName,
      start: merged.start,
      end: merged.end,
      isManual: true,
      manualType: 'merged',
      mergedFromIds: merged.mergedFromIds,
    };
  }

  async split(id: string, splitDate: string) {
    if (!id || !splitDate) {
      throw Object.assign(new Error('Podaj id rezerwacji i datę podziału.'), { status: 400 });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      throw Object.assign(new Error('Nie znaleziono rezerwacji.'), { status: 404 });
    }

    const splitD = toLocalMidnight(splitDate);
    const startD = toLocalMidnight(booking.start);
    const endD = toLocalMidnight(booking.end);

    if (splitD <= startD || splitD >= endD) {
      throw Object.assign(
        new Error(
          `Data podziału (${splitDate}) musi należeć do zakresu rezerwacji: po ${booking.start.toISOString().slice(0, 10)} i przed ${booking.end.toISOString().slice(0, 10)}.`,
        ),
        { status: 400 },
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

    return [
      { id: String(first._id), start: first.start, end: first.end },
      { id: String(second._id), start: second.start, end: second.end },
    ];
  }

  async undoMerge(id: string) {
    if (!id) throw Object.assign(new Error('Podaj id scalonej rezerwacji.'), { status: 400 });
    const merged = await Booking.findById(id);
    if (!merged || merged.manualType !== 'merged') {
      throw Object.assign(new Error('Nie znaleziono scalonej rezerwacji.'), { status: 404 });
    }
    await Booking.findByIdAndDelete(id);
  }

  async undoSplit(id: string) {
    if (!id) throw Object.assign(new Error('Podaj id podzielonej rezerwacji.'), { status: 400 });
    const splitBooking = await Booking.findById(id);
    if (!splitBooking || splitBooking.manualType !== 'split') {
      throw Object.assign(new Error('Nie znaleziono podzielonej rezerwacji.'), { status: 404 });
    }
    const originalId = splitBooking.splitFromId;
    if (!originalId) {
      throw Object.assign(new Error('Brak informacji o oryginalnej rezerwacji.'), { status: 400 });
    }
    await Booking.deleteMany({ splitFromId: originalId, manualType: 'split' });
  }

  async resolveConflict(manualId: string, decision: 'keep' | 'remove') {
    if (!manualId || !['keep', 'remove'].includes(decision)) {
      throw Object.assign(new Error('Podaj manualId i decision (keep|remove).'), { status: 400 });
    }

    const manual = await Booking.findById(manualId);
    if (!manual || !manual.isManual) {
      throw Object.assign(new Error('Nie znaleziono rezerwacji manualnej.'), { status: 404 });
    }

    if (decision === 'remove') {
      await Booking.findByIdAndDelete(manualId);
    } else {
      await Booking.findByIdAndUpdate(manualId, { $set: { hasConflict: false } });
    }
  }
}
