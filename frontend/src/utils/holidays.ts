import Holidays from 'date-holidays';

export interface HolidayInfo {
  date: string; // YYYY-MM-DD
  name: string;
}

const hd = new Holidays('PL');

/** Returns all Polish public holidays for a given year as { date, name }[]. */
export function getPolishHolidays(year: number): HolidayInfo[] {
  return hd
    .getHolidays(year)
    .filter((h) => h.type === 'public')
    .map((h) => ({
      date: h.date.slice(0, 10),
      name: h.name,
    }));
}

/** Returns a Set of YYYY-MM-DD strings for quick O(1) lookup, spanning multiple years. */
export function buildHolidaySet(years: number[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const y of years) {
    for (const h of getPolishHolidays(y)) {
      map.set(h.date, h.name);
    }
  }
  return map;
}

/** Returns holiday name if the date (YYYY-MM-DD) is a Polish public holiday, else null. */
export function getHolidayName(date: string, holidayMap: Map<string, string>): string | null {
  return holidayMap.get(date) ?? null;
}
