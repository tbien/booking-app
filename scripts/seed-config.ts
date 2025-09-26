import * as fs from 'fs';
import * as path from 'path';

function main() {
  const configDir = path.join(process.cwd(), 'config');
  const configFile = path.join(configDir, 'ical-properties.json');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  if (fs.existsSync(configFile)) {
    console.log('config/ical-properties.json już istnieje.');
    return;
  }
  const example = [
    { name: 'Apartament 1', url: 'https://www.airbnb.pl/calendar/ical/xxxx.ics?s=token' },
    { name: 'Apartament 1', url: 'https://ical.booking.com/v1/export?t=token' }
  ];
  fs.writeFileSync(configFile, JSON.stringify(example, null, 2), 'utf-8');
  console.log('Utworzono config/ical-properties.json (przykład).');
}

main();


