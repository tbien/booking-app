# Booking App (iCal + MongoDB)

A standalone application to synchronize bookings from iCal into MongoDB and view them in a simple UI.

## Requirements

- Node.js >= 20
- MongoDB (local or remote)

## Environment Variables

- `PORT` (default: 4000)
- `MONGODB_URI` (default: `mongodb://localhost:27017/booking-app`)
- `ICAL_DAYS_AHEAD` (default: 35) - Number of days ahead to fetch bookings
- `ICAL_SORT_BY` (default: 'end') - Sort bookings by 'start' or 'end'

## Installation & Start (without Docker)

```bash
npm install
npm run dev
```

- UI: http://localhost:4000/
- Config UI: http://localhost:4000/config

## Docker (recommended for quick start)

```bash
docker compose up --build
```

- App: http://localhost:4000/
- MongoDB: localhost:27017 (mongo service inside container)

Environment variables can be set in `docker-compose.yml` or `.env` (Docker Compose reads it automatically).

## Features

- Synchronizes current bookings from iCal to MongoDB automatically when viewing data (background process).
- Calculates "URGENT" status for changeovers.
- Browse booking history from the database (with date filters, pagination).
- Edit guest count and notes with delayed save.
- Configure iCal properties (name, URL, cleaning cost) via UI.
- View summary of cleaning costs for the current month.

## API Endpoints

- `GET /ical/data` - Fetch bookings (with optional filters: from, to, daysAhead, sortBy, page, limit)
- `GET /ical/properties` - Get configured properties
- `POST /ical/properties` - Add new property
- `PUT /ical/properties/:id` - Update property
- `DELETE /ical/properties/:id` - Delete property
- `POST /ical/guests` - Update guest count for a booking
- `POST /ical/notes` - Update notes for a booking
- `GET /ical/summary/current-month` - Get total cleaning costs for current month

## Scripts

- `npm run build` - Build TypeScript
- `npm run start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm run seed-config` - Create example `config/ical-properties.json` (if not exists)
- `npm run clean` - Remove dist folder
- `npm run format` - Format code with Prettier

## Configuration

Properties are managed via the `/config` UI or directly in MongoDB `PropertyConfig` collection.

Example property:

- Name: "Apartment 1"
- iCal URL: "https://www.airbnb.pl/calendar/ical/xxx.ics?s=token"
- Cleaning Cost: 100 (optional, for summary calculations)
