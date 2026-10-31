import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
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
  const [checks, setChecks] = useState<Record<number, boolean | undefined>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [odo, setOdo] = useState('');
  const [hours, setHours] = useState('');

  const items = s.today?.inspection?.items ?? [];
  const required = !!s.today?.inspection?.required;
  // Inspected today on the server, or an inspection for this truck is waiting to sync.
  const inspectedToday = useMemo(() => {
    if (!truck) return false;
    if (truck.inspected_at) return true;
    const today = new Date().toDateString();
    return s.pending.some((o) => o.type === 'inspection' && o.truck_id === truck.id && new Date(o.at).toDateString() === today);
  }, [truck, s.pending]);
  const needInspection = !!truck && items.length > 0 && !inspectedToday;
  const answered = items.every((_, i) => checks[i] !== undefined);
  const failed = items.filter((_, i) => checks[i] === false);
  // Off the road on the server, or a failed inspection for it is still waiting to sync.
  const offRoad = !!truck && (!!truck.out_of_service || s.pending.some((o) => o.type === 'inspection' && o.truck_id === truck.id && o.items.some((x) => !x.ok)));

  function pickTruck(id: string) {
    const tr = s.today?.trucks.find((x) => x.id === id);
    setTruckId(id);
    setMeter(tr?.last_meter_reading != null ? String(tr.last_meter_reading) : '');
    setOdo(tr?.odometer_km != null ? String(Math.round(Number(tr.odometer_km))) : '');
    setHours(tr?.engine_hours != null ? String(Number(tr.engine_hours)) : '');
    setChecks({});
    setNotes({});
  }

  async function sendInspection(): Promise<boolean> {
    if (!truck) return false;
    const list = items.map((label, i) => ({ label, ok: checks[i] !== false, note: notes[i]?.trim() || null }));
    await s.inspect(truck.id, { items: list, odometer_km: parseNum(odo), engine_hours: parseNum(hours), notes: null });
    return !list.some((x) => !x.ok);
  }

  async function goOnDuty() {
    if (!truck) return;
    if (needInspection && (required || answered)) {
      if (!answered) return Alert.alert('Finish the inspection', 'Mark every item as OK or a problem before going on duty.');
      if (failed.length) {
        return Alert.alert(
          `${failed.length} problem${failed.length === 1 ? '' : 's'} found`,
          `${truck.name} will be taken off the road and the office will be told. Pick another truck or wait for the repair.`,
          [
            { text: 'Go back', style: 'cancel' },
            { text: 'Report problems', style: 'destructive', onPress: async () => { setBusy(true); await sendInspection(); setBusy(false); router.back(); } },
          ],
        );
      }
      setBusy(true);
      await sendInspection();
      setBusy(false);
    }
    await start();
  }

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
          <Pressable key={tr.id} onPress={() => pickTruck(tr.id)}>
            <Card style={tr.id === truckId ? { borderColor: t.accent, borderWidth: 2 } : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <T size={19} weight="700">{tr.name}</T>
                {tr.out_of_service ? <T size={13} weight="700" color={t.danger}>OFF THE ROAD</T> : tr.inspected_at ? <T size={13} weight="600" color={t.ok}>Inspected today</T> : null}
              </View>
              <T muted>{[tr.plate, `${tr.capacity_l.toLocaleString('en-CA')} L tank`].filter(Boolean).join(' · ')}</T>
              {tr.out_of_service && tr.out_of_service_reason ? <T size={14} color={t.danger}>{tr.out_of_service_reason}</T> : null}
            </Card>
          </Pressable>
        ))}
        {truck && offRoad && (
          <Card style={{ borderColor: t.danger, borderWidth: 2, marginTop: 8 }}>
            <T size={18} weight="700" color={t.danger}>{truck.name} is off the road</T>
            <T>{truck.out_of_service_reason ?? 'The office marked it out of service.'}</T>
            <T muted>Pick another truck, or ask the office to put it back on the road once it's fixed.</T>
          </Card>
        )}
        {needInspection && !offRoad && (
          <View style={{ gap: 10, marginTop: 8 }}>
            <T size={20} weight="700">Pre-trip inspection{required ? '' : ' (optional)'}</T>
            <T muted>Walk around {truck!.name}. Tap OK or Problem for each item.</T>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label="Odometer (km)" value={odo} onChangeText={setOdo} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Field label="Engine hours" value={hours} onChangeText={setHours} keyboardType="decimal-pad" /></View>
            </View>
            {items.map((label, i) => (
              <Card key={i} style={checks[i] === false ? { borderColor: t.danger, borderWidth: 2 } : undefined}>
                <T size={17} weight="600">{label}</T>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  {([true, false] as const).map((ok) => {
                    const on = checks[i] === ok;
                    const c = ok ? t.ok : t.danger;
                    return (
                      <Pressable key={String(ok)} accessibilityRole="button" accessibilityState={{ selected: on }}
                        onPress={() => setChecks({ ...checks, [i]: ok })}
                        style={{ flex: 1, minHeight: 52, borderRadius: 10, borderWidth: 2, borderColor: on ? c : t.border, backgroundColor: on ? c : t.card, alignItems: 'center', justifyContent: 'center' }}>
                        <T size={17} weight="700" color={on ? '#fff' : c}>{ok ? 'OK' : 'Problem'}</T>
                      </Pressable>
                    );
                  })}
                </View>
                {checks[i] === false && (
                  <TextInput maxLength={400} placeholder="What's wrong?" placeholderTextColor={t.muted} value={notes[i] ?? ''} onChangeText={(v) => setNotes({ ...notes, [i]: v })}
                    style={{ marginTop: 8, borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: 17, color: t.text, backgroundColor: t.bg }} />
                )}
              </Card>
            ))}
          </View>
        )}
        {truck && !offRoad && (
          <View style={{ gap: 16, marginTop: 8 }}>
            <Field
              label="Meter reading on the truck now"
              value={meter}
              onChangeText={setMeter}
              keyboardType="decimal-pad"
              hint={truck.last_meter_reading != null ? `Last recorded: ${truck.last_meter_reading}` : undefined}
            />
            <BigButton
              title={needInspection && failed.length ? 'Report problems' : needInspection && (required || answered) ? 'Finish inspection and go on duty' : 'Go on duty'}
              kind={needInspection && failed.length ? 'danger' : 'primary'}
              disabled={needInspection && required && !answered}
              onPress={goOnDuty}
              busy={busy}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
