import session from 'express-session';
import MongoStore from 'connect-mongo';
import { config } from '../config';

/**
 * Configured express-session middleware with MongoDB store.
 */
export const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: config.mongoURI as string,
    ttl: 7 * 24 * 60 * 60,
    autoRemove: 'native',
  }),
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
  },
});
