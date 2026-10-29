# Water Delivery: dispatch, driver app and tank metering

Software for running a community water truck service: the office takes requests and dispatches jobs, drivers record each delivery on their phone (litres from the truck meter, a photo of the meter, an optional signature), and a level sensor on the bulk holding tank reports how much water left it so deliveries can be checked against it every day.

It replaces the software half of the IronSight proposal for Fort Good Hope. The truck flow meters and the tank sensor are still hardware you buy and install; see [docs/tank-sensor.md](docs/tank-sensor.md).

## What's in here

| Folder | What it is |
|---|---|
| `server/` | API and database (Node.js, TypeScript, Postgres). Also serves the office web app and receives tank sensor readings. |
| `web/` | Office web app: dispatch board with live map, jobs, customers and delivery points, trucks and people, reports. |
| `mobile/` | Driver app for iPhone and Android (Expo / React Native), built for the App Store and Google Play. |
| `docs/` | Setup, store release, sensor hookup, and how-to guides for the office and drivers. |

```
 Driver phones ──(HTTPS, offline queue)──┐
                                         ├──> server (API + office web app) ──> Postgres
 Office browser ──(HTTPS + live updates)─┤
 Tank level sensor ──(HTTPS POST)────────┘
```

## Features

**Office (web)**
- Dispatch board: request queue plus one column per driver; drag jobs to assign and reorder. Drivers get a phone alert.
- Live map of trucks on duty and today's delivery points, coloured by status.
- Job detail with delivery record, meter photo, signature, GPS trail and a full change history. PDF delivery ticket.
- Customers and delivery points (with map placement and arrival radius), CSV import from a spreadsheet.
- Trucks, drivers, dispatchers and admins; tank sensors with their own keys.
- Reports: litres per day drawn from the tank vs. delivered, per truck and per customer, truck fills, tank level chart, CSV export for accounting.

**Drivers (phone)**
- Go on duty, pick the truck, enter the meter reading.
- Today's jobs, one big button for the next step: Start job, I've arrived, Record delivery.
- Directions in the phone's maps app; arrival is logged automatically by geofence.
- Delivery entry works out litres from meter start and end, takes a meter photo, optional signature.
- Works with no signal: everything is saved on the phone and sent when back in range, and the screen shows what hasn't been sent.
- Fill logging at the bulk tank, so loaded litres can be matched to the tank sensor.

## Quick start (local)

Requires Node 22 and Postgres 14+.

```bash
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm ci
npm run seed -- --demo        # creates admin@example.com / admin12345 plus demo trucks, drivers, customers and two weeks of history
npm run dev:server            # API on http://localhost:3000
npm run dev:web               # office app on http://localhost:5173
```

Try it without a phone:

```bash
cd server
npm run simulate-driver                         # a demo driver drives to jobs and records deliveries; watch the dispatch board
DEVICE_KEY=<key printed by seed> npm run simulate-tank   # a fake tank sensor
```

Driver app: `cd mobile && npm ci && npx expo run:ios` (or `run:android`). See [docs/driver-app.md](docs/driver-app.md).

Tests: `npm test` (needs a `watertruck_test` database, or set `TEST_DATABASE_URL`).

## Going live

1. [docs/setup.md](docs/setup.md): host the server and database, create the first admin, load customers and trucks.
2. [docs/tank-sensor.md](docs/tank-sensor.md): connect the bulk tank sensor.
3. [docs/driver-app.md](docs/driver-app.md): build the driver app, pilot it through TestFlight and Play internal testing, then submit to the stores.
4. Hand out [docs/office-guide.md](docs/office-guide.md) and [docs/driver-guide.md](docs/driver-guide.md).
5. Keep [docs/runbook.md](docs/runbook.md) for whoever looks after it.
