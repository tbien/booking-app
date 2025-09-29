# Booking App (iCal + MongoDB)

A standalone application to synchronize bookings from iCal into MongoDB and view them in a simple UI.

## Requirements

- Node.js >= 16
- MongoDB (lokalnie lub zdalnie)

## Requirements

1. Environment variable `MONGODB_URI` (default `mongodb://localhost:27017/booking-app`).
2. iCal sources:
   - iCal sources: `ICAL_PROPERTIES` win `.env` as JSON (array of`{name,url}`), e.g.:

```
ICAL_PROPERTIES=[{"name":"Apartament 1","url":"https://www.airbnb.pl/calendar/ical/xxx.ics?s=token"},{"name":"Apartament 1","url":"https://ical.booking.com/v1/export?t=token"}]
```

- Fallback: `config/ical-properties.json` file in the project directory.

## Installation & Start (without Docker)

```
npm install
npm run dev
```

- UI: http://localhost:4000/

## Docker (recommended for quick start)

```
docker compose up --build
```

- App: http://localhost:4000/
- MongoDB: localhost:27017 (service mongo inside container)
- Environment variables can be set in docker-compose.yml or .env (Docker Compose reads it automatically).

## Environment variables can be set in docker-compose.yml or .env (Docker Compose reads it automatically)

- Synchronizes current bookings from iCal to MongoDB, calculates “URGENT” status.
- Browse booking history from the database (from/to params), without triggering synchronization.
- Edit guest count with delayed save.
- Range presets: current month, previous month.
