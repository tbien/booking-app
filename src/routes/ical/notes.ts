import express from 'express';
import { Booking } from '../../models/Booking';
import { notesSchema } from './shared';

const router = express.Router();

router.post('/notes', async (req, res) => {
  try {
    const { error, value } = notesSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });
    await Booking.updateOne({ _id: value.id }, { $set: { notes: value.notes } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

export default router;
