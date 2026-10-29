// Background tasks must be registered before anything renders.
import '../lib/location';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from '../components/ui';
import { StoreProvider } from '../lib/store';

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.card },
            headerTintColor: t.accent,
            headerTitleStyle: { color: t.text, fontWeight: '700' },
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Today' }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="shift" options={{ title: 'Shift' }} />
          <Stack.Screen name="job/[id]" options={{ title: 'Job' }} />
          <Stack.Screen name="complete/[id]" options={{ title: 'Record delivery' }} />
          <Stack.Screen name="fill" options={{ title: 'Fill the truck' }} />
          <Stack.Screen name="settings" options={{ title: 'Sync & settings' }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
