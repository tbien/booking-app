import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-app',
  nodeEnv: process.env.NODE_ENV,
};
