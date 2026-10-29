# Setting up the server

The server is one Node.js app that serves the API, the office web app and the tank feed, plus a Postgres database. At pilot size (a few trucks, a few hundred deliveries a week) the smallest paid plans are plenty: expect roughly $15 to $40 a month in total.

## Option A: Render (simplest)

1. Push this repository to GitHub.
2. In Render, choose **New > Blueprint** and pick the repository. `render.yaml` creates the web service and a Postgres database.
3. When asked, set `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The first start creates that admin account.
4. When it's live, open the service URL, sign in, and change the admin password (or add your own admin account and disable the seeded one).
5. Add a custom domain if you want one (for example `water.fortgoodhope.ca`). The driver app needs the final address, so settle this before building the store version.

## Option B: any Docker host plus any Postgres

Build and run the container with the environment variables from `.env.example`:

```bash
docker build -t water-delivery .
docker run -p 3000:3000 \
  -e DATABASE_URL='postgres://user:pass@host:5432/db?sslmode=require' \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='a strong password' \
  -e APP_TIMEZONE=America/Edmonton -e ORG_NAME='Your organisation' \
  water-delivery
```

Supabase or Neon work as the database: copy the connection string (the direct or session-pooler one, with `?sslmode=require`). The app creates its tables on start.

Put it behind HTTPS. Phones will not send data to a plain `http://` server in store builds.

## Environment variables

| Name | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Long random string. Changing it signs everyone out. |
| `APP_TIMEZONE` | no | Day boundaries for "today" and reports. Default `America/Edmonton` (Mountain time, as used in the NWT). |
| `ORG_NAME` | no | Shown on delivery tickets |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first start | Creates the first admin if that email doesn't exist yet |
| `SEED_DEMO` | no | `true` adds demo data on first start. Leave off in production. |
| `PUSH_ENABLED` | no | `false` turns off new-job alerts |
| `PORT` | no | Default 3000 |

## Loading your data

1. **Trucks & people**: add each truck (name, plate, tank size, meter serial) and each driver and dispatcher. Drivers sign in to the phone app with the email and password you set.
2. **Customers**: either add them one by one, or put them in a spreadsheet with columns `customer, account_code, phone, email, site_label, address, lat, lng, tank_capacity_l, access_notes`, save it as CSV, and use **Import CSV** on the Customers page. Rows with the same account code become one customer with several delivery points.
3. **Delivery point locations** matter: automatic arrival only works for points with a map location. Open each delivery point and click where the truck parks to fill. The arrival radius (default 75 m) can be widened for large lots.
4. **Tank sensor**: add it under Trucks & people > Bulk water tanks and give the key to whoever configures the sensor. See [tank-sensor.md](tank-sensor.md).

## Backups

Use the database host's automatic daily backups (Render, Supabase and Neon all include them) and check once that a restore works. Delivery records are the billing record, so keep at least 30 days of backups.
