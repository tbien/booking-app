import express from 'express';
import { Booking } from '../../models/Booking';
import { guestSchema } from './shared';

const router = express.Router();

router.post('/guests', async (req, res) => {
  try {
    const { error, value } = guestSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });
    await Booking.updateOne({ _id: value.id }, { $set: { guests: value.guests } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

export default router;
