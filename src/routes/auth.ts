import express from 'express';
import bcrypt from 'bcryptjs';
import { AdminCredentials } from '../models/AdminCredentials';
import { requireAdmin } from '../middleware/auth';

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// POST /auth/login
router.post('/auth/login', async (req, res) => {
  const { password } = req.body as { password?: string };

  if (!password) {
    return res.status(400).json({ success: false, error: 'Brak hasła' });
  }

  const credentials = await AdminCredentials.findOne({ userId: 'admin' });
  if (!credentials) {
    return res.status(500).json({
      success: false,
      error: 'Admin password not initialized. Run: npm run init-admin',
    });
  }

  const valid = await bcrypt.compare(password, credentials.passwordHash);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Nieprawidłowe hasło' });
  }

  req.session.userId = 'admin';
  req.session.role = 'admin';

  res.json({ success: true, role: 'admin' });
});

// POST /auth/logout
router.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Błąd wylogowania' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// GET /auth/me – sprawdź aktualną sesję
router.get('/auth/me', (req, res) => {
  if (req.session?.userId) {
    return res.json({
      success: true,
      role: req.session.role || 'user',
      userId: req.session.userId,
    });
  }
  // Niezalogowany → zwróć role 'user' (możliwość oglądania bez logowania)
  res.json({ success: true, role: 'user', userId: null });
});

// POST /auth/change-password – zmiana hasła admina (wymaga zalogowania jako admin)
router.post('/auth/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ success: false, error: 'Wymagane: currentPassword i newPassword' });
  }

  if (newPassword.length < 8) {
    return res
      .status(400)
      .json({ success: false, error: 'Nowe hasło musi mieć co najmniej 8 znaków' });
  }

  const credentials = await AdminCredentials.findOne({ userId: 'admin' });
  if (!credentials) {
    return res.status(500).json({ success: false, error: 'Brak poświadczeń w bazie' });
  }

  const valid = await bcrypt.compare(currentPassword, credentials.passwordHash);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Nieprawidłowe aktualne hasło' });
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await AdminCredentials.updateOne({ userId: 'admin' }, { $set: { passwordHash: newHash } });

  res.json({ success: true, message: 'Hasło zostało zmienione' });
});

export default router;
