# Fort Good Hope: client requirements and gap check

Source: answers from Adrian GJ Hodgson, CPA, CA (Interim Director of Finance, Charter Community of K'asho Got'ine), forwarded by Barrett Gaunce on November 2, 2026, in reply to Garrett's discovery questions. Compared against this repository as of commit `d0f6808`.

## 1. Confirmed facts

### The problem today
- The current system is **20+ years old and broken**. It records litres pumped, but the **dates and customers on imported deliveries are wrong**. The vendor blamed a cable, charged $500 for a $15 cable, and it did not fix anything.
- Nothing about it is worth keeping. Support is limited and the vendor is "gouging" on parts.
- It is **hard to learn** and needs training. Adrian's bar: "I can jump into most software and learn it by fiddling around."
- What "fixed" looks like: **correct date and customer on every delivery**, **GPS tracking of vehicles**, and software that stays current and supported.

### Operations
| Item | Answer |
|---|---|
| Trucks | 2 operational trucks |
| Drivers | 2 |
| Customers | About 500 households (and commercial accounts) |
| Seasonal change | None of note in winter |
| In the trucks | Flow meters coupled to old palm-pilot-style handhelds |
| Driver workflow | Plug hose into the house hook-up, fill, unplug; the meter records the delivery; close the ticket; next house. "Fool-proof" by design. |
| Schedule | Fixed delivery schedule, plus a **call-out option for a fee** |
| People day to day | Drivers, Financial Clerk, Reception (payments and change-of-service requests) |
| Decision | Council has approved the switch and left the choice of software to staff. No further procurement step mentioned. |

### Connectivity
- **Must work offline.** Syncing when the truck is parked at the shop is acceptable, but there are **dead zones in town**, so the driver app must work fully offline for whole runs, not just brief gaps.

### Billing
- **Three rate classes:**
  - **Commercial**: anything that is not residential.
  - **Residential**: tenant in NWT Housing, or renting from another housing company.
  - **Subsidized residential**: the homeowner is billed directly.
- **Flat garbage fee** added on: **$15 Commercial, $10 Residential** (frequency and whether subsidized pays $10 still to confirm, see section 4).
- **Call-out** deliveries carry an extra fee.
- **Accounting:** Sage 50 now, **Xero** "sometime in the future". All financial reports are done in the accounting system.

### Reporting
- **Annual water usage report for the community, due to the government.** No other reports owed from this system.

### Commercial terms
- **Timeline:** ASAP, realistic about **a month or more**.
- **Pricing model:** **subscription** preferred, so it stays updated and supported.
- **Data in Canada, owned by the band:** ideal, **not a deal breaker**.

### Future ideas they raised
- **Household tank level sensors** so drivers skip houses above a set % full, cutting fuel over time.
- **VOIP call-out line:** residents call a number; after hours it routes into the system and **texts all drivers**.
- Resident texting (request water, low-tank alerts): "could be useful".

## 2. What the app already covers

| Need | Status in the app | Where |
|---|---|---|
| Correct date and customer per delivery | **Covered.** Each delivery is tied to a job and customer when it is recorded on the phone, with its own timestamp, GPS point and a unique id, so a resend cannot duplicate or reassign it. | `mobile/src/lib/queue.ts`, `server/src/routes/driver.ts` |
| GPS tracking of trucks | **Covered.** Background GPS while on duty, live map in the office, GPS trail per job, geofenced arrival. | `mobile/src/lib/location.ts`, `web/src/components/Map.tsx` |
| Offline driver app | **Mostly covered.** Actions queue in on-phone SQLite and send when back in range; today's jobs are cached. Gap: see below. | `mobile/src/lib/db.ts`, `mobile/src/lib/store.tsx` |
| Fixed schedule | **Covered.** Recurring jobs by every N days or by weekdays. | `server/src/lib/recurring.ts` |
| Rate classes | **Partly.** Customer classes with per-class prices exist, but the default classes are Residential, Public housing, Commercial, Institutional. | `server/src/lib/settings.ts`, `server/src/lib/billing.ts` |
| Invoicing | **Covered.** Batch draft invoices per customer per period, from approved deliveries. | `server/src/lib/billing.ts` |
| Accounting | **QuickBooks only** (Online sync and QBO CSV). Not Sage 50 or Xero. | `server/src/lib/quickbooks.ts` |
| Reports | Daily litres drawn vs delivered, per truck, per customer, CSV export. No annual report. | `server/src/lib/reports.ts` |
| Resident texts | **Covered** (Twilio SMS and email alerts for scheduled, en route, completed). | `server/src/lib/messaging.ts` |
| Resident requests | **Covered** through the web request portal. No phone or text intake. | `server/src/routes/portal.ts` |
| Low-tank prediction | **Covered by estimate.** Days-until-empty from each house's delivery history, no sensor needed. | `server/src/lib/forecast.ts` |
| Ease of use | Driver app has one big next-step button. Office app is feature-rich, which risks the "needs training" complaint. | |

## 3. Gaps and prioritized build list

### Must have before go-live (target: within the month)
1. **Rate classes to match theirs.** Seed Commercial, Residential, Subsidized residential, drop Public housing and Institutional for this client, and enter their real per-litre prices. Small: settings and seed change.
2. **Flat garbage fee per class.** The price book can auto-add a line to *every delivery*, which would charge garbage per fill. They need a **flat fee per billing period per customer**, by class ($15 Commercial, $10 Residential). Add a "per invoice" fee type to the price book, applied once in `generateInvoices`. Small to medium.
3. **Sage 50 export.** Replace or sit beside the QuickBooks export with a Sage 50 (Canadian edition) import file for customers and sales invoices. Needs their Sage version and chart of accounts to test the file against. Medium.
4. **Call-out jobs with a fee.** Mark a job as a call-out (and after-hours) so the call-out fee line is added automatically and reports can count them. Small.
5. **Offline for a whole run.** The phone caches only the last fetched "today" list. Add: download the full day (and tomorrow) at the shop, let a driver **record an unscheduled delivery to any customer from a cached customer list** while offline, and show clearly when the phone last synced. Medium.
6. **Import from the old system.** Load the ~500 customers, sites, classes and current balances (if any) from whatever the old system or Sage 50 can export. Customer CSV import already exists, so this is mostly mapping. Small to medium, depends on their data.
7. **Simplify the office app for this client.** Hide features they did not ask for (inspections, chat, forms, approvals tuning, QuickBooks) behind settings so Reception and the Financial Clerk see: Customers, Schedule, Deliveries, Invoices, Export. Test with someone who has not seen it. Medium.

### Should have soon after
8. **Annual water usage report.** One-click yearly report: total litres by month, by rate class, by customer, number of deliveries, households served, call-outs. Needs the government's required format (ask for last year's). Small once the format is known.
9. **Meter capture without typing.** Today drivers type meter start and end and take a photo. Their current system reads the meter automatically, which is what makes it "fool-proof". Find out the meter make and model; if it has Bluetooth or a serial output (for example a Liquid Controls LectroCount register), read the litres straight into the delivery. Medium to large, hardware dependent. Until then, the typed reading plus photo is the fallback.
10. **Driver devices.** Recommend two rugged Android phones or small tablets to replace the palm-style handhelds. Include in the quote.
11. **Xero sync.** Add a Xero connector (OAuth API, or Xero's invoice CSV import as a first step) for when they switch. Medium.
12. **Canadian data hosting.** Offer it as an option: a database in a Canadian region (for example Supabase ca-central-1 or a Canadian Postgres host) and an app host in Canada. Not required now.

### Later (their long-term ideas)
13. **After-hours call-out line.** A Twilio (or similar) phone number: the caller leaves their name and address or picks from a menu, the system creates a call-out request and texts every driver on call. Builds on the existing Twilio SMS. Medium.
14. **Household tank level sensors.** Extend the bulk tank sensor ingest to per-house sensors, then skip scheduled stops above a set % full. Needs a hardware pilot on a few houses first. Large, mostly hardware and cost.

## 4. Open questions to ask next

**Billing**
- What are the current per-litre (or per-delivery) prices for each class? Is there a minimum charge?
- Is the garbage fee monthly, per delivery, or per invoice? Does Subsidized residential pay the $10 Residential garbage fee?
- For Residential (NWT Housing and other landlords), is the bill sent to the tenant or to the housing company?
- What is the call-out fee, and is it different after hours?
- How often are customers invoiced (monthly?), and is GST charged on water and garbage?
- Does anything need to be paid at the counter (Reception takes payments)? Should payments be recorded in this system or only in Sage 50?

**Accounting**
- Which Sage 50 edition and year? Can we get a sample customer list and one month of sales invoices exported from it?
- Rough timeline for moving to Xero?

**Reporting**
- Which department receives the annual water usage report? Can we see last year's report or the form?

**Hardware**
- What make and model are the truck flow meters? Do they have Bluetooth, a serial port or a printer port?
- Do the drivers currently print tickets for customers, or is the ticket only electronic?
- Do the trucks have power for a phone or tablet mount, and should we supply the devices?

**Data and migration**
- Can the old system export customers and delivery history? How far back do they need history kept?
- Is there a customer list with addresses or lot numbers we can use to place houses on the map?

**Operations**
- How is the fixed schedule set today (by zone, by day of week)? How many stops per truck per day?
- Who should get after-hours call-out texts: both drivers, or an on-call rotation?
- How many people will log in to the office side (Financial Clerk, Reception, anyone else)?

**Commercial**
- Is there a budget range for the subscription, and does it need to fit a fiscal year (April to March)?
- Who signs the agreement, and does anything go back to council?

## 5. Notes for the proposal
- Lead with what they asked for: **correct dates and customers, GPS, offline, easy to learn, supported by subscription.**
- Show the driver app's one-button flow and the offline sync screen; it answers the "Frankenstein" complaint directly.
- Compare against IronSight's quote ($24k a year plus $3.5k setup, see `research/ironsight-findings.md` in project files). A subscription well below that, with setup, migration and Sage 50 export included, is the pitch.
- Keep tank sensors and the VOIP line as a phase 2 so the first month is realistic.
