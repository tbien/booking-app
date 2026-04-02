import ical, { ICalEventStatus, ICalEventTransparency } from 'ical-generator';
import { Property } from '../models/Property';
import { Booking } from '../models/Booking';

export class CalendarExportService {
  async generateFeed(exportToken: string): Promise<{ icsData: string; filename: string } | null> {
    const property: any = await Property.findOne({ exportToken }).lean();
    if (!property) return null;

    const bookings = await Booking.find({
      propertyId: String(property._id),
      isManual: true,
      manualType: 'block',
      cancellationStatus: { $exists: false },
    }).lean();

    const calendar = ical({
      name: property.displayName,
      prodId: { company: 'booking-app', product: 'calendar' },
    });

    for (const booking of bookings as any[]) {
      calendar.createEvent({
        id: booking.uid,
        start: new Date(booking.start),
        end: new Date(booking.end),
        summary: 'Not available',
        description: booking.blockReason || '',
        status: ICalEventStatus.CONFIRMED,
        transparency: ICalEventTransparency.OPAQUE,
      });
    }

    return { icsData: calendar.toString(), filename: `${property.name}.ics` };
  }
}
