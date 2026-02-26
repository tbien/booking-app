import mongoose from 'mongoose';
import { Booking } from '../src/models/Booking';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-app';

async function fixNovemberBookings() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB:', MONGO_URI);

    // Check total bookings first
    const totalBookings = await Booking.countDocuments({});
    console.log('Total bookings in database:', totalBookings);

    // Find November bookings that are marked as cancelled
    // Use overlap logic: bookings that intersect with November
    const novemberStart = new Date(2025, 10, 1, 0, 0, 0, 0); // Local timezone
    const novemberEnd = new Date(2025, 10, 30, 23, 59, 59, 999); // Local timezone

    console.log('Date range:', { novemberStart, novemberEnd });

    const result = await Booking.updateMany(
      {
        $and: [
          { start: { $lte: novemberEnd } },
          { end: { $gte: novemberStart } },
          { cancellationStatus: 'cancelled' },
        ],
      },
      { $set: { cancellationStatus: null } },
    );

    console.log(`✅ Updated ${result.modifiedCount} November bookings (unmarked as cancelled)`);

    // Show current counts using overlap logic
    const totalNovember = await Booking.countDocuments({
      $and: [{ start: { $lte: novemberEnd } }, { end: { $gte: novemberStart } }],
    });
    const activeNovember = await Booking.countDocuments({
      $and: [
        { start: { $lte: novemberEnd } },
        { end: { $gte: novemberStart } },
        { cancellationStatus: { $ne: 'cancelled' } },
      ],
    });

    console.log(`📊 Total November bookings: ${totalNovember}`);
    console.log(`📊 Active November bookings: ${activeNovember}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixNovemberBookings();
