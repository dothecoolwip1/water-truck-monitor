import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { BigButton, Card, Field, parseNum, Screen, T, useTheme } from '../components/ui';
import { requestLocation } from '../lib/location';
import { useStore } from '../lib/store';

export default function ShiftScreen() {
  const s = useStore();
  const t = useTheme();
  const [truckId, setTruckId] = useState<string | null>(null);
  const truck = s.today?.trucks.find((x) => x.id === truckId);
  const [meter, setMeter] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!truckId) return;
    setBusy(true);
    try {
      const perm = await requestLocation();
      if (perm === 'denied') {
        Alert.alert(
          'Location is off',
          'Without location the office cannot see the truck, and arrivals must be tapped by hand. You can turn it on in Settings.',
          [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Continue anyway' }],
        );
      } else if (perm === 'foreground') {
        Alert.alert(
          'Allow location "Always"',
          'Choose "Always" (iPhone) or "Allow all the time" (Android) so arrivals are logged with the phone in your pocket.',
          [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Later' }],
        );
      }
      await s.startShift(truckId, parseNum(meter));
      router.back();
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    const openJobs = s.jobs.filter((j) => j.status === 'en_route' || j.status === 'arrived');
    const go = async () => {
      setBusy(true);
      await s.endShift(parseNum(meter));
      setBusy(false);
      router.back();
    };
    if (openJobs.length) {
      Alert.alert('A job is still under way', `#${openJobs[0].number} ${openJobs[0].site_label} isn't finished. End the shift anyway?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End shift', style: 'destructive', onPress: go },
      ]);
    } else await go();
  }

  if (s.shift) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          <T size={22} weight="700">End shift on {s.shift.truck_name}</T>
          <Field label="Truck meter reading now (optional)" value={meter} onChangeText={setMeter} keyboardType="decimal-pad" />
          <BigButton title="End shift" kind="danger" onPress={end} busy={busy} />
        </ScrollView>
      </Screen>
    );
  }

  const trucks = s.today?.trucks ?? [];
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <T size={22} weight="700">Which truck are you driving?</T>
        {trucks.length === 0 && <T muted>No trucks loaded yet. Pull down on the main screen to refresh, or check signal.</T>}
        {trucks.map((tr) => (
          <Pressable key={tr.id} onPress={() => { setTruckId(tr.id); setMeter(tr.last_meter_reading != null ? String(tr.last_meter_reading) : ''); }}>
            <Card style={tr.id === truckId ? { borderColor: t.accent, borderWidth: 2 } : undefined}>
              <T size={19} weight="700">{tr.name}</T>
              <T muted>{[tr.plate, `${tr.capacity_l.toLocaleString('en-CA')} L tank`].filter(Boolean).join(' · ')}</T>
            </Card>
          </Pressable>
        ))}
        {truck && (
          <View style={{ gap: 16, marginTop: 8 }}>
            <Field
              label="Meter reading on the truck now"
              value={meter}
              onChangeText={setMeter}
              keyboardType="decimal-pad"
              hint={truck.last_meter_reading != null ? `Last recorded: ${truck.last_meter_reading}` : undefined}
            />
            <BigButton title="Go on duty" onPress={start} busy={busy} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
