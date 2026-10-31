import type { ExpoConfig } from 'expo/config';

// Values that differ per organisation come from the environment so the same
// code can be built for the pilot and for production. See docs/driver-app.md.
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const bundleId = process.env.APP_BUNDLE_ID ?? 'ca.fortgoodhope.waterdelivery';
const easProjectId = process.env.EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: process.env.APP_NAME ?? 'Water Delivery',
  slug: 'water-delivery-driver',
  scheme: 'waterdelivery',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: bundleId,
    supportsTablet: true,
    buildNumber: '1',
    infoPlist: {
      // The app only uses standard encryption (HTTPS), so no export compliance paperwork is needed.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: bundleId,
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#1769AA',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS'],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    ['expo-secure-store', { faceIDPermission: false }],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Your location is recorded only while you are on duty, so the office can see where the truck is and deliveries are logged at the right house.',
        locationAlwaysPermission:
          'Your location is recorded only while you are on duty, so deliveries are logged at the right house.',
        locationWhenInUsePermission: 'Your location is used while you are on duty to log arrivals at delivery points.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission: 'The camera is used to photograph the truck meter after each delivery.',
        photosPermission: false,
      },
    ],
    ['expo-notifications', { color: '#1769AA' }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
