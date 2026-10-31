# Connecting the bulk tank sensor

The system reads the level of the main holding tank to see how much water trucks drew from it each day, and compares that with what drivers recorded as delivered. Any level sensor or gateway that can send an HTTPS POST works.

## Choosing hardware

- **Spartan ARMOR (from the proposal).** Before buying, ask Spartan Controls: *"Can the ARMOR unit's readings be sent to our own web address (HTTPS POST or MQTT), not only to IronSight?"* If yes, give them the details below. If it only reports to IronSight, it won't work with this system.
- **Alternatives:** any cellular tank level monitor with a "webhook", "HTTP push" or "REST output" option. Ultrasonic or radar sensors on the lid and pressure transducers at the bottom both work. A reading every 5 to 15 minutes is enough; every minute is better while trucks are filling.

## Setting it up

1. In the office app, go to **Trucks & people > Bulk water tanks > Add tank sensor**.
2. Enter the tank's capacity in litres and, if the sensor reports depth or distance, the water height when full in mm.
3. Copy the device id and key shown. The key is shown once; use **New key** to replace a lost one.
4. Configure the sensor (or its cloud portal) to send:

```
POST https://<your server>/api/ingest/tank-readings
Headers:
  x-device-id: <device id>
  x-device-key: <key>
  content-type: application/json
Body, one of:
  {"ts": "2026-11-02T14:00:00Z", "volume_l": 182400}
  {"ts": "2026-11-02T14:00:00Z", "level_mm": 4380}       water depth
  {"ts": "2026-11-02T14:00:00Z", "distance_mm": 1620}    gap from the lid down to the water
  {"ts": "2026-11-02T14:00:00Z", "level_pct": 72.9}
```

`ts` can be an ISO time or Unix seconds; if missing, the time of receipt is used. Several readings can be sent at once as `{"readings": [ ... ]}`. The key can also go in `Authorization: Bearer <key>`, with the device id as `device_id` in the body.

Test from any computer:

```bash
curl -X POST https://<your server>/api/ingest/tank-readings \
  -H 'content-type: application/json' -H 'x-device-id: armor-001' -H 'x-device-key: <key>' \
  -d '{"level_pct": 65}'
```

A `202` response means it was stored. The current level then shows on the Trucks & people page and the tank chart on Reports.

## How the numbers are used

- **Drawn from the tank** (Reports): every period when the level fell is a draw-down. Drops smaller than the noise setting (default 200 L) are ignored, and refills of the tank end a draw-down.
- **Truck fills**: when a driver taps "Fill the truck" then "Truck is full", the litres drawn are the level just before minus the level just after.
- **Not accounted for**: drawn minus delivered. Water left in trucks at the end of the day shows up here, so look at the trend over a week rather than one day.

If the sensor is set up with MQTT only, a small bridge (for example a Node-RED flow) can forward messages to the address above.
