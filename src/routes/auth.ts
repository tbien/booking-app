import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import { AuthService } from '../services/AuthService';

const router = Router();
const authService = new AuthService();

router.post('/auth/login', async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) return res.status(400).json({ success: false, error: 'Brak hasła' });

  try {
    const { role } = await authService.login(password);
    req.session.userId = 'admin';
    req.session.role = role;
    res.json({ success: true, role });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, error: 'Błąd wylogowania' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

router.get('/auth/me', (req, res) => {
  if (req.session?.userId) {
    return res.json({ success: true, role: req.session.role || 'user', userId: req.session.userId });
  }
  res.status(401).json({ success: false, role: null, userId: null });
});

router.post('/auth/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Wymagane: currentPassword i newPassword' });
  }

  try {
    await authService.changePassword(currentPassword, newPassword);
    res.json({ success: true, message: 'Hasło zostało zmienione' });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

export default router;
