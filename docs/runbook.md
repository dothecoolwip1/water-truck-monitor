# Runbook

For whoever looks after the system after launch.

## Health
- `GET /api/health` returns `{"ok":true}` when the server and database are up. Point an uptime monitor (for example UptimeRobot, free) at it.
- Tank sensor silent: Trucks & people shows the last reading time. More than an hour old during the day means the sensor, its power or its cellular link is down.

## Common tasks
| Task | How |
|---|---|
| Driver forgot password | Admin: Trucks & people > Edit > new password |
| Driver leaving | Edit > untick **Can sign in**. Their history stays. |
| Lost tank sensor key | Bulk water tanks > **New key**, then update the sensor |
| Wrong delivery recorded | Records are locked once completed, so they stay trustworthy for billing. Correct it in the accounting export, or in the database with care, and note why. |
| Phone lost with unsent deliveries | Unsent items are only on that phone. Enter them from paper with **Enter paper ticket**. |

## Updating the software
1. Make the change on a branch; CI runs the tests.
2. Merge to `main`. Render redeploys automatically; on other hosts rebuild and restart the container. Database changes run on start.
3. Driver app: see [driver-app.md](driver-app.md).

## Where data lives
- Postgres holds everything, including meter photos and signatures (about 150 KB each, so roughly 1 GB per 6,000 deliveries).
- Tables: `jobs`, `deliveries`, `fills`, `gps_points` (route trail), `tank_readings`, `audit_log` (every change, with who and when), `customers`, `sites`, `trucks`, `users`, `source_tanks`, `files`.
- To trim old route points after a year: `delete from gps_points where ts < now() - interval '12 months';`

## Security notes
- Passwords are hashed with bcrypt; sign-in tokens last 30 days. Changing `JWT_SECRET` signs everyone out.
- Sensor keys are stored hashed; only the key shown once at creation can authenticate.
- Office links to photos and PDFs carry the signed-in user's token in the URL, so don't forward those links outside the office.
