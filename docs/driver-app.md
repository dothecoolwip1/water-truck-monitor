# Driver app: building, piloting and publishing

The driver app lives in `mobile/`. It is an Expo (React Native) app, built in the cloud with EAS, so nobody needs a Mac with Xcode to ship it.

## What you need first

| Account | Cost | Who should own it |
|---|---|---|
| Apple Developer Program (organisation) | US$99/year | The organisation, not a person. Enrolling as an organisation needs a D-U-N-S number, which can take a week or two to get, so start early. |
| Google Play Console | US$25 once | The organisation. New personal accounts must run a 14-day closed test with 12 testers before going public; organisation accounts are exempt. |
| Expo account | free tier is enough | Same people who own the code |
| The live server address over HTTPS | | See [setup.md](setup.md) |

## Settings to fill in

- `mobile/eas.json`: replace `https://REPLACE-WITH-YOUR-SERVER` with the live server address (in `preview` and `production`), and `ascAppId` with the App Store Connect app id once the app record exists.
- Bundle id: defaults to `ca.fortgoodhope.waterdelivery`. Change it with `APP_BUNDLE_ID` before the first store upload; it cannot change afterwards.
- App name: `APP_NAME` (defaults to "Water Delivery").

## One-time setup

```bash
cd mobile
npm ci
npx eas-cli@latest login
npx eas-cli@latest init          # creates the Expo project and prints its id
```

Put the project id in the environment for builds (`EAS_PROJECT_ID`, for example as an EAS environment variable) so new-job alerts work. Push notifications use Expo's service, which delivers through Apple and Google; EAS sets up the Apple push key and asks for the Firebase file for Android the first time.

## Pilot (weeks 2 and 3 of the plan)

```bash
npx eas-cli@latest build --profile preview --platform all
```

- **iPhone**: submit the build to TestFlight (`npx eas-cli@latest submit -p ios --latest`), then add pilot drivers as internal testers in App Store Connect. They install the TestFlight app and get the driver app from there.
- **Android**: either install the preview build directly from the link EAS gives (internal distribution), or upload to Play Console > Testing > Internal testing and add drivers' Google accounts.

What to check on a real route (gloves on, patchy signal):
- Arrival logs by itself at each house with the phone in a pocket or a cradle.
- Deliveries entered with no signal show "saved on this phone" and go through when back in range.
- Meter photo is readable on the delivery ticket.
- Battery lasts a full shift with location on (keep phones on a charger in the cab).

## Store release (week 4)

```bash
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --platform all --latest
```

### Apple App Store

Because the app is only for your own drivers, choose one of:
- **Unlisted app** (recommended): goes through normal review but only people with the link can find it. Request it from Apple after the first approval, or at submission.
- **Public listing**: works too, but reviewers expect it to be useful to the public, so explain clearly that it is a workforce app.

For review, provide:
- A **demo driver account** with a couple of jobs assigned for that day (reviewers sign in and tap through). Create a "Reviewer" driver and leave two jobs scheduled for them.
- Notes explaining background location: "Drivers' location is recorded only between Go on duty and End shift, to show trucks on the dispatch map and log arrival at customer water tanks."
- The **privacy policy URL**: `https://<your server>/privacy.html` (fill in the template in `web/public/privacy.html` first).
- App Privacy answers: collects precise location, photos, name, email and user content; linked to the user; used for app functionality; not used for tracking.

### Google Play

- Complete the **Data safety** form with the same answers as above.
- Fill in the **background location declaration**: the purpose is "Logging deliveries and arrival at customer locations while the driver is on duty". Google asks for a short video showing the in-app explanation and the permission prompt: record going on duty in the app.
- Declare the foreground service type **location** (the build already sets it) and give the same reason.
- Start on the internal track, then promote to production when the pilot is done.

## Updating the app later

- JavaScript-only changes (screens, wording, fixes) can go out instantly with `npx eas-cli@latest update --branch production` once EAS Update is configured, with no store review.
- Changes to native modules or permissions need a new build and store submission. Bump `version` in `app.config.ts`; build numbers increase automatically.

## Running it locally

```bash
cd mobile
EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:3000 npx expo run:android   # or run:ios on a Mac
```

The sign-in screen has a "Change server" link for pointing a test phone at another server.
