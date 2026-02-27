import axios from 'axios';
import * as ical from 'node-ical';

export interface ICalReservation {
  summary: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  uid: string;
  source: string;
  propertyName?: string;
}

export interface ICalProperty {
  name: string;
  icalUrl: string;
}

export interface ICalExportRequest {
  properties?: ICalProperty[];
  urls?: string[];
  daysAhead?: number;
  sortBy?: 'start' | 'end';
}

export class ICalExportService {
  private async fetchICalData(url: string): Promise<string> {
    const res = await axios.get(url, {
      timeout: 30000, // 30 seconds timeout to prevent hanging requests
      maxRedirects: 5,
    });
    return res.data;
  }

  private parseICalData(
    icalData: string,
    sourceUrl: string,
    propertyName?: string,
  ): ICalReservation[] {
    const reservations: ICalReservation[] = [];
    const parsed = ical.parseICS(icalData);

    // Normalize a node-ical date to UTC midnight.
    // When iCal sends VALUE=DATE (all-day), node-ical creates the date as LOCAL midnight,
    // e.g. DTSTART;VALUE=DATE:20260328 on a Warsaw server (UTC+1) becomes 27.03T23:00Z.
    // We always want UTC midnight so all comparisons are timezone-independent.
    const toUtcMidnight = (d: Date): Date => {
      if ((d as any).dateOnly) {
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      }
      return d;
    };

    for (const key in parsed) {
      const event = parsed[key];
      if (event.type !== 'VEVENT') continue;

      // Validate dates - skip events with invalid dates
      const start = toUtcMidnight(event.start);
      const end = toUtcMidnight(event.end || new Date(start.getTime() + 3600000));

      // Check if dates are valid
      if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) {
        console.warn(`Skipping event with invalid dates: ${event.uid || 'unknown'}`);
        continue;
      }

      // Ensure end is after start
      if (end.getTime() <= start.getTime()) {
        console.warn(`Skipping event with end date before start: ${event.uid || 'unknown'}`);
        continue;
      }

      let summary = event.summary || '';
      summary = summary.replace(/\\n/g, ' ').replace(/\\,/g, ',');
      if (summary.includes('CLOSED - Not available') || summary.includes('Not available'))
        summary = 'NIEDOSTĘPNE';
      else if (summary.includes('Reserved')) summary = 'ZAREZERWOWANE';
      else if (summary.includes('Airbnb (Not available)')) summary = 'NIEDOSTĘPNE (Airbnb)';
      const description = event.description
        ? event.description.replace(/\\n/g, ' ').replace(/\\,/g, ',')
        : undefined;
      const location = event.location
        ? event.location.replace(/\\n/g, ' ').replace(/\\,/g, ',')
        : undefined;
      const uid = event.uid || `generated-${Date.now()}-${Math.random()}`;
      reservations.push({
        summary,
        start,
        end,
        description,
        location,
        uid,
        source: sourceUrl,
        propertyName,
      });
    }
    return reservations;
  }

  private filterReservationsByDaysAhead(
    reservations: ICalReservation[],
    daysAhead: number,
  ): ICalReservation[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    cutoff.setHours(23, 59, 59, 999);

    return reservations.filter((r) => {
      const checkoutDate = new Date(r.end);
      return checkoutDate >= today && checkoutDate <= cutoff;
    });
  }

  private sortReservations(
    reservations: ICalReservation[],
    sortBy: 'start' | 'end' = 'start',
  ): ICalReservation[] {
    return [...reservations].sort((a, b) =>
      sortBy === 'start'
        ? a.start.getTime() - b.start.getTime()
        : a.end.getTime() - b.end.getTime(),
    );
  }

  private async fetchAllReservations(
    properties: ICalProperty[],
    urls: string[],
    summary: any,
  ): Promise<ICalReservation[]> {
    const all: ICalReservation[] = [];
    for (const p of properties) {
      try {
        const data = await this.fetchICalData(p.icalUrl);
        const res = this.parseICalData(data, p.icalUrl, p.name);
        all.push(...res);
        summary.successfulUrls++;
        summary.totalReservations += res.length;
      } catch (e) {
        summary.failedUrls++;
        summary.errors.push(`Błąd dla ${p.name}: ${e}`);
      }
    }
    for (const url of urls) {
      try {
        const data = await this.fetchICalData(url);
        const res = this.parseICalData(data, url);
        all.push(...res);
        summary.successfulUrls++;
        summary.totalReservations += res.length;
      } catch (e) {
        summary.failedUrls++;
        summary.errors.push(`Błąd dla ${url}: ${e}`);
      }
    }
    return all;
  }

  async fetchReservations(
    request: ICalExportRequest,
  ): Promise<{ reservations: ICalReservation[]; summary: any }> {
    const properties = request.properties || [];
    const urls = request.urls || [];
    const summary = {
      totalUrls: properties.length + urls.length,
      successfulUrls: 0,
      failedUrls: 0,
      totalReservations: 0,
      filteredReservations: 0,
      errors: [] as string[],
    };
    const all = await this.fetchAllReservations(properties, urls, summary);
    let filtered = all;
    if (request.daysAhead && request.daysAhead > 0) {
      filtered = this.filterReservationsByDaysAhead(all, request.daysAhead);
      summary.filteredReservations = filtered.length;
    }
    const sortBy = request.sortBy || 'start';
    filtered = this.sortReservations(filtered, sortBy);
    return { reservations: filtered, summary };
  }

  // Fetch reservations and filter them by an explicit date range [from, to]
  async fetchReservationsInRange(request: {
    properties?: ICalProperty[];
    urls?: string[];
    from: Date;
    to: Date;
    sortBy?: 'start' | 'end';
  }): Promise<{ reservations: ICalReservation[]; summary: any }> {
    const properties = request.properties || [];
    const urls = request.urls || [];
    const summary = {
      totalUrls: properties.length + urls.length,
      successfulUrls: 0,
      failedUrls: 0,
      totalReservations: 0,
      filteredReservations: 0,
      errors: [] as string[],
    };

    const all = await this.fetchAllReservations(properties, urls, summary);

    // Filter by checkout date within the range (to avoid conflicts with existing data)
    const from = request.from;
    const to = request.to;
    const sortBy = request.sortBy || 'start';

    let filtered = all.filter((r) => {
      // Overlap filter: matches the DB query used in sync (start <= to AND end >= from)
      // This ensures iCal and DB queries fetch the same set of bookings
      return r.start <= to && r.end >= from;
    });

    summary.filteredReservations = filtered.length;
    filtered = this.sortReservations(filtered, sortBy);

    return { reservations: filtered, summary };
  }
}
