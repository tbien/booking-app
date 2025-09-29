import axios from 'axios';

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
    const res = await axios.get(url);
    return res.data;
  }

  private parseICalDate(dateString: string): Date {
    const clean = dateString.replace(/[TZ]/g, '');
    if (clean.length === 8) {
      const y = parseInt(clean.substring(0, 4));
      const m = parseInt(clean.substring(4, 6)) - 1;
      const d = parseInt(clean.substring(6, 8));
      return new Date(y, m, d);
    }
    const y = parseInt(clean.substring(0, 4));
    const m = parseInt(clean.substring(4, 6)) - 1;
    const d = parseInt(clean.substring(6, 8));
    const hh = parseInt(clean.substring(8, 10));
    const mm = parseInt(clean.substring(10, 12));
    const ss = clean.length >= 14 ? parseInt(clean.substring(12, 14)) : 0;
    return new Date(y, m, d, hh, mm, ss);
  }

  private parseICalData(
    icalData: string,
    sourceUrl: string,
    propertyName?: string,
  ): ICalReservation[] {
    const reservations: ICalReservation[] = [];
    const eventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
    let match;
    while ((match = eventRegex.exec(icalData)) !== null) {
      const eventData = match[1];
      const summaryMatch = eventData.match(/SUMMARY:(.*)/);
      const startMatch = eventData.match(/DTSTART(?:;VALUE=DATE)?(?:;TZID=[^:]*)?:(.*)/);
      const endMatch = eventData.match(/DTEND(?:;VALUE=DATE)?(?:;TZID=[^:]*)?:(.*)/);
      const descriptionMatch = eventData.match(/DESCRIPTION:(.*)/);
      const locationMatch = eventData.match(/LOCATION:(.*)/);
      const uidMatch = eventData.match(/UID:(.*)/);
      if (summaryMatch && startMatch) {
        const start = this.parseICalDate(startMatch[1]);
        const end = endMatch
          ? this.parseICalDate(endMatch[1])
          : new Date(start.getTime() + 3600000);
        let cleanSummary = summaryMatch[1].replace(/\\n/g, ' ').replace(/\\,/g, ',');
        if (
          cleanSummary.includes('CLOSED - Not available') ||
          cleanSummary.includes('Not available')
        )
          cleanSummary = 'NIEDOSTĘPNE';
        else if (cleanSummary.includes('Reserved')) cleanSummary = 'ZAREZERWOWANE';
        else if (cleanSummary.includes('Airbnb (Not available)'))
          cleanSummary = 'NIEDOSTĘPNE (Airbnb)';
        reservations.push({
          summary: cleanSummary,
          start,
          end,
          description: descriptionMatch
            ? descriptionMatch[1].replace(/\\n/g, ' ').replace(/\\,/g, ',')
            : undefined,
          location: locationMatch
            ? locationMatch[1].replace(/\\n/g, ' ').replace(/\\,/g, ',')
            : undefined,
          uid: uidMatch ? uidMatch[1] : `generated-${Date.now()}-${Math.random()}`,
          source: sourceUrl,
          propertyName,
        });
      }
    }
    return reservations;
  }

  private filterReservationsByDaysAhead(
    reservations: ICalReservation[],
    daysAhead: number,
  ): ICalReservation[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    return reservations.filter((r) => r.start <= cutoff);
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

  async fetchReservations(
    request: ICalExportRequest,
  ): Promise<{ reservations: ICalReservation[]; summary: any }> {
    const all: ICalReservation[] = [];
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
    let filtered = all;
    if (request.daysAhead && request.daysAhead > 0) {
      filtered = this.filterReservationsByDaysAhead(all, request.daysAhead);
      summary.filteredReservations = filtered.length;
    }
    const sortBy = request.sortBy || 'start';
    filtered = this.sortReservations(filtered, sortBy);
    return { reservations: filtered, summary };
  }
}
