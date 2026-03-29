/**
 * CF Workers-compatible ICalExportService.
 *
 * Key differences from the Express version:
 *  - Uses fetch() instead of axios (no Node.js http/https modules)
 *  - Uses an inline iCal parser with ZERO external dependencies
 *    (node-ical loads node:fs at the top level which crashes CF Workers)
 */

// ── Minimal inline iCal parser ────────────────────────────────────────────────
interface ParsedEvent {
  type: string;
  uid?: string;
  start?: Date;
  end?: Date;
  summary?: string;
  description?: string;
  location?: string;
}

function unfoldLines(raw: string): string[] {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r\n|\n/);
}

function parseICalDate(line: string): Date | null {
  const sep = line.indexOf(':');
  if (sep === -1) return null;
  const v = line.slice(sep + 1).trim().replace(/Z$/, '');
  if (/^\d{8}T\d{6}/.test(v)) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
    const h = +v.slice(9, 11), m = +v.slice(11, 13), s = +v.slice(13, 15);
    return new Date(Date.UTC(y, mo, d, h, m, s));
  }
  if (/^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
    return new Date(Date.UTC(y, mo, d));
  }
  return null;
}

function unescapeIcal(s: string): string {
  return s.replace(/\\n/g, ' ').replace(/\\N/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseICS(raw: string): ParsedEvent[] {
  const lines = unfoldLines(raw);
  const events: ParsedEvent[] = [];
  let current: ParsedEvent | null = null;

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).toUpperCase();
    const val = line.slice(colonIdx + 1);
    const baseKey = key.split(';')[0];

    if (baseKey === 'BEGIN' && val.trim() === 'VEVENT') { current = { type: 'VEVENT' }; continue; }
    if (baseKey === 'END'   && val.trim() === 'VEVENT') { if (current) events.push(current); current = null; continue; }
    if (!current) continue;

    switch (baseKey) {
      case 'UID':         current.uid         = unescapeIcal(val.trim()); break;
      case 'DTSTART':     current.start       = parseICalDate(line) ?? undefined; break;
      case 'DTEND':       current.end         = parseICalDate(line) ?? undefined; break;
      case 'SUMMARY':     current.summary     = unescapeIcal(val); break;
      case 'DESCRIPTION': current.description = unescapeIcal(val); break;
      case 'LOCATION':    current.location    = unescapeIcal(val); break;
    }
  }
  return events;
}

// ── Service ───────────────────────────────────────────────────────────────────

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
    const events = parseICS(icalData);

    for (const event of events) {
      if (event.type !== 'VEVENT') continue;

      const start = event.start;
      const end = event.end || (start ? new Date(start.getTime() + 86_400_000) : undefined);

      if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) continue;
      if (end.getTime() <= start.getTime()) continue;

      let summary = event.summary || '';
      if (summary.includes('CLOSED - Not available') || summary.includes('Not available'))
        summary = 'NIEDOSTĘPNE';
      else if (summary.includes('Reserved')) summary = 'ZAREZERWOWANE';
      else if (summary.includes('Airbnb (Not available)')) summary = 'NIEDOSTĘPNE (Airbnb)';

      // Deterministic UID fallback via FNV-1a (no crypto dependency)
      const uid = event.uid || (() => {
        const raw = `${sourceUrl}|${start.toISOString()}|${end.toISOString()}`;
        let h = 0x811c9dc5;
        for (let i = 0; i < raw.length; i++) {
          h ^= raw.charCodeAt(i);
          h = (Math.imul(h, 0x01000193) >>> 0);
        }
        return `generated-${h.toString(16).padStart(8, '0')}-${start.getTime().toString(36)}`;
      })();

      reservations.push({ summary, start, end, description: event.description, location: event.location, uid, source: sourceUrl, propertyName, propertyId });
    }
    return reservations;
  }

  private sortReservations(reservations: ICalReservation[], sortBy: 'start' | 'end' = 'start'): ICalReservation[] {
    return [...reservations].sort((a, b) =>
      sortBy === 'start' ? a.start.getTime() - b.start.getTime() : a.end.getTime() - b.end.getTime(),
    );
  }

  private async fetchAllReservations(properties: ICalProperty[], urls: string[], summary: any): Promise<ICalReservation[]> {
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

  async fetchReservations(request: ICalExportRequest): Promise<{ reservations: ICalReservation[]; summary: any }> {
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

  async fetchReservationsInRange(request: { properties?: ICalProperty[]; urls?: string[]; from: Date; to: Date; sortBy?: 'start' | 'end'; }): Promise<{ reservations: ICalReservation[]; summary: any }> {
    const properties = request.properties || [];
    const urls = request.urls || [];
    const summary = { totalUrls: properties.length + urls.length, successfulUrls: 0, failedUrls: 0, totalReservations: 0, filteredReservations: 0, errors: [] as string[] };
    const all = await this.fetchAllReservations(properties, urls, summary);
    const filtered = all.filter((r) => r.start <= request.to && r.end >= request.from);
    summary.filteredReservations = filtered.length;
    return { reservations: this.sortReservations(filtered, request.sortBy || 'start'), summary };
  }
}
