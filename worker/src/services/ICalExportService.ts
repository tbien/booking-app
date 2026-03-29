/**
 * CF Workers-compatible ICalExportService.
 * Replaces the original src/services/ICalExportService.ts for the worker build.
 *
 * Key differences from the Express version:
 *  - Uses fetch() instead of axios (no Node.js http/https modules)
 *  - Imports only the iCal parser from node-ical/ical.js (avoids the top-level
 *    `require('node:fs')` in node-ical's main entry point which crashes CF Workers)
 */

declare const require: (id: string) => any;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const icalParser = require('node-ical/ical.js') as {
  parseICS: (data: string) => Record<string, any>;
};

export interface ICalReservation {
  summary: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  uid: string;
  source: string;
  propertyName?: string;
  propertyId?: string;
}

export interface ICalProperty {
  name: string;
  icalUrl: string;
  propertyId?: string;
}

export interface ICalExportRequest {
  properties?: ICalProperty[];
  urls?: string[];
  daysAhead?: number;
  sortBy?: 'start' | 'end';
}

export class ICalExportService {
  private async fetchICalData(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseICalData(
    icalData: string,
    sourceUrl: string,
    propertyName?: string,
    propertyId?: string,
  ): ICalReservation[] {
    const reservations: ICalReservation[] = [];
    const parsed = icalParser.parseICS(icalData);

    const toUtcMidnight = (d: Date): Date => {
      if ((d as any).dateOnly) {
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      }
      return d;
    };

    for (const key in parsed) {
      const event = parsed[key];
      if (event.type !== 'VEVENT') continue;

      const start = toUtcMidnight(event.start);
      const end = toUtcMidnight(event.end || new Date(start.getTime() + 3_600_000));

      if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) continue;
      if (end.getTime() <= start.getTime()) continue;

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

      // Deterministic UID fallback (Web Crypto instead of node:crypto)
      const uid =
        event.uid ||
        (() => {
          const raw = `${sourceUrl}|${start.toISOString()}|${end.toISOString()}`;
          // Simple deterministic hash using TextEncoder + a fold (no crypto.createHash needed)
          let h = 0x811c9dc5;
          for (let i = 0; i < raw.length; i++) {
            h ^= raw.charCodeAt(i);
            h = (Math.imul(h, 0x01000193) >>> 0);
          }
          return `generated-${h.toString(16).padStart(8, '0')}-${start.getTime().toString(36)}`;
        })();

      reservations.push({ summary, start, end, description, location, uid, source: sourceUrl, propertyName, propertyId });
    }
    return reservations;
  }

  private sortReservations(
    reservations: ICalReservation[],
    sortBy: 'start' | 'end' = 'start',
  ): ICalReservation[] {
    return [...reservations].sort((a, b) =>
      sortBy === 'start' ? a.start.getTime() - b.start.getTime() : a.end.getTime() - b.end.getTime(),
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
        const res = this.parseICalData(data, p.icalUrl, p.name, p.propertyId);
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
    const summary = { totalUrls: properties.length + urls.length, successfulUrls: 0, failedUrls: 0, totalReservations: 0, filteredReservations: 0, errors: [] as string[] };
    const all = await this.fetchAllReservations(properties, urls, summary);
    let filtered = all;
    if (request.daysAhead && request.daysAhead > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + request.daysAhead); cutoff.setHours(23, 59, 59, 999);
      filtered = all.filter((r) => { const d = new Date(r.end); return d >= today && d <= cutoff; });
      summary.filteredReservations = filtered.length;
    }
    return { reservations: this.sortReservations(filtered, request.sortBy || 'start'), summary };
  }

  async fetchReservationsInRange(request: {
    properties?: ICalProperty[];
    urls?: string[];
    from: Date;
    to: Date;
    sortBy?: 'start' | 'end';
  }): Promise<{ reservations: ICalReservation[]; summary: any }> {
    const properties = request.properties || [];
    const urls = request.urls || [];
    const summary = { totalUrls: properties.length + urls.length, successfulUrls: 0, failedUrls: 0, totalReservations: 0, filteredReservations: 0, errors: [] as string[] };
    const all = await this.fetchAllReservations(properties, urls, summary);
    const filtered = all.filter((r) => r.start <= request.to && r.end >= request.from);
    summary.filteredReservations = filtered.length;
    return { reservations: this.sortReservations(filtered, request.sortBy || 'start'), summary };
  }
}
