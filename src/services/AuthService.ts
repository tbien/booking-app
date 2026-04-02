import bcrypt from 'bcryptjs';
import { AdminCredentials } from '../models/AdminCredentials';

const BCRYPT_ROUNDS = 12;

export class AuthService {
  async login(password: string): Promise<{ role: 'admin' }> {
    const credentials = await AdminCredentials.findOne({ userId: 'admin' });
    if (!credentials) {
      const err: any = new Error('Admin password not initialized. Run: npm run init-admin');
      err.status = 500;
      throw err;
    }

    const valid = await bcrypt.compare(password, credentials.passwordHash);
    if (!valid) {
      const err: any = new Error('Nieprawidłowe hasło');
      err.status = 401;
      throw err;
    }

    return { role: 'admin' };
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      const err: any = new Error('Nowe hasło musi mieć co najmniej 8 znaków');
      err.status = 400;
      throw err;
    }

    const credentials = await AdminCredentials.findOne({ userId: 'admin' });
    if (!credentials) {
      const err: any = new Error('Brak poświadczeń w bazie');
      err.status = 500;
      throw err;
    }

    const valid = await bcrypt.compare(currentPassword, credentials.passwordHash);
    if (!valid) {
      const err: any = new Error('Nieprawidłowe aktualne hasło');
      err.status = 401;
      throw err;
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await AdminCredentials.updateOne({ userId: 'admin' }, { $set: { passwordHash: newHash } });
  }
}
