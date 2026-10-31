import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { BigButton, Card, T, useTheme } from '../components/ui';
import { server } from '../lib/config';
import { locationPermission, type PermissionState } from '../lib/location';
import { lastSyncedAt } from '../lib/queue';
import { useStore } from '../lib/store';

const LABEL: Record<string, string> = {
  shift_start: 'Going on duty',
  shift_end: 'Ending shift',
  job_start: 'Starting a job',
  job_arrive: 'Arrival',
  job_complete: 'Delivery',
  fill: 'Truck fill',
  gps: 'Route points',
};

export default function Settings() {
  const s = useStore();
  const t = useTheme();
  const [perm, setPerm] = useState<PermissionState | null>(null);
  useEffect(() => {
    locationPermission().then(setPerm).catch(() => setPerm(null));
  }, []);
  const synced = lastSyncedAt() ?? s.lastRefresh;
  const unsent = s.pending.filter((o) => o.type !== 'gps');

  function signOut() {
    if (unsent.length) {
      return Alert.alert('Not everything is sent yet', `${unsent.length} item(s) are still on this phone. Get signal and wait for them to send before signing out, or they will be lost.`);
    }
    Alert.alert('Sign out?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void s.logout().then(() => router.replace('/login')) },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card>
        <T weight="700">Sending to the office</T>
        <T muted>{s.online ? 'Connected' : 'No signal right now'}{synced ? ` · last contact ${synced.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}` : ''}</T>
        {unsent.length === 0 ? <T>Nothing waiting.</T> : unsent.map((o) => <T key={o.client_id}>• {LABEL[o.type]} {'at' in o ? new Date(o.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : ''}</T>)}
        {s.pendingGps > 0 && <T size={14} muted>{s.pendingGps} route points waiting</T>}
        <View style={{ marginTop: 8 }}>
          <BigButton small title="Send now" onPress={() => void s.syncNow()} busy={s.syncing} />
        </View>
      </Card>

      {s.problems.length > 0 && (
        <Card style={{ borderColor: t.danger }}>
          <T weight="700" color={t.danger}>The office didn't accept these</T>
          {s.problems.map((p) => (
            <View key={p.client_id} style={{ paddingVertical: 4 }}>
              <T weight="600">{LABEL[p.type] ?? p.type}</T>
              <T size={14} muted>{p.error}</T>
            </View>
          ))}
          <T size={14} muted>Tell the office about these so they can fix the record. Then clear the list.</T>
          <BigButton small kind="secondary" title="Clear list" onPress={() => void s.clearProblems()} />
        </Card>
      )}

      <Card>
        <T weight="700">Location</T>
        <T muted>
          {perm === 'always' ? 'Allowed all the time. Arrivals are logged automatically.' : perm === 'foreground' ? 'Allowed only while the app is open. Choose "Always" so arrivals are logged with the phone in your pocket.' : 'Off. The office cannot see the truck and you will need to tap "I\'ve arrived".'}
        </T>
        {perm !== 'always' && <BigButton small kind="secondary" title="Open phone settings" onPress={() => void Linking.openSettings()} />}
      </Card>

      <Card>
        <T weight="700">{s.user?.name}</T>
        <T size={14} muted>{s.user?.email}</T>
        <T size={14} muted>Server: {server()}</T>
        <T size={14} muted>App version {Constants.expoConfig?.version}</T>
      </Card>
      <BigButton small kind="danger" title="Sign out" onPress={signOut} />
    </ScrollView>
  );
}
