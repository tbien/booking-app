/**
 * Skrypt inicjalizujący hasło admina w bazie danych.
 * Uruchom raz przy pierwszym wdrożeniu:
 *
 *   npm run init-admin
 *
 * lub z własnym hasłem:
 *
 *   ADMIN_INIT_PASSWORD=moje-haslo npm run init-admin
 *
 * Hasło musi mieć co najmniej 8 znaków.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import * as readline from 'readline';
import { AdminCredentials } from '../src/models/AdminCredentials';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-app';
const BCRYPT_ROUNDS = 12;

const askPassword = (): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write('Podaj nowe hasło admina (min. 8 znaków): ');
    // Disable echo for password input
    if ((process.stdin as any).isTTY) {
      (process.stdin as any).setRawMode(true);
    }
    let pass = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (ch: string) => {
      ch = ch.toString();
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        if ((process.stdin as any).isTTY) (process.stdin as any).setRawMode(false);
        process.stdout.write('\n');
        rl.close();
        resolve(pass);
      } else if (ch === '\u0003') {
        process.exit(0);
      } else {
        pass += ch;
        process.stdout.write('*');
      }
    });
  });
};

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Połączono z MongoDB:', MONGO_URI);

  const existing = await AdminCredentials.findOne({ userId: 'admin' });
  if (existing) {
    console.log('⚠️  Hasło admina już istnieje w bazie.');
    const override = process.env.FORCE === '1';
    if (!override) {
      console.log('   Aby nadpisać, uruchom z FORCE=1: FORCE=1 npm run init-admin');
      await mongoose.disconnect();
      process.exit(0);
    }
    console.log('   FORCE=1 – nadpisuję hasło...');
  }

  // Hasło może być podane przez env (do CI/Docker), albo interaktywnie
  let password = process.env.ADMIN_INIT_PASSWORD || '';

  if (!password) {
    password = await askPassword();
  }

  if (password.length < 8) {
    console.error('❌ Hasło musi mieć co najmniej 8 znaków.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await AdminCredentials.findOneAndUpdate(
    { userId: 'admin' },
    { userId: 'admin', passwordHash },
    { upsert: true, new: true },
  );

  console.log('✅ Hasło admina zostało zapisane w bazie danych.');
  console.log('   Możesz teraz zalogować się przez /login');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Błąd:', err.message);
  process.exit(1);
});
