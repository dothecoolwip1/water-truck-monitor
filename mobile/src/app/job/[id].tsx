import { Alert, Linking, Platform, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { BigButton, Card, clock, litres, Screen, T, useTheme } from '../../components/ui';
import { useStore } from '../../lib/store';

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStore();
  const t = useTheme();
  const job = s.jobs.find((j) => j.id === id);
  if (!job) {
    return (
      <Screen style={{ padding: 16 }}>
        <T>This job is no longer on your list. It may have been reassigned or cancelled by the office.</T>
      </Screen>
    );
  }
  const otherActive = s.jobs.find((j) => j.id !== job.id && (j.status === 'en_route' || j.status === 'arrived'));

  function directions() {
    if (job!.site_lat == null || job!.site_lng == null) {
      const q = encodeURIComponent(job!.site_address ?? job!.site_label);
      void Linking.openURL(Platform.OS === 'ios' ? `maps://?q=${q}` : `geo:0,0?q=${q}`);
      return;
    }
    const ll = `${job!.site_lat},${job!.site_lng}`;
    void Linking.openURL(Platform.OS === 'ios' ? `maps://?daddr=${ll}&dirflg=d` : `google.navigation:q=${ll}`).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${ll}`),
    );
  }

  function start() {
    if (!s.shift) return Alert.alert('Go on duty first', 'Start your shift and pick a truck before starting a job.');
    const go = async () => {
      await s.startJob(job!.id);
      directions();
    };
    if (otherActive) {
      Alert.alert('Another job is under way', `#${otherActive.number} ${otherActive.site_label} isn't finished. Start this one too?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => void go() },
      ]);
    } else void go();
  }

  let primary: { title: string; onPress: () => void } | null = null;
  if (job.status === 'scheduled') primary = { title: 'Start job', onPress: start };
  else if (job.status === 'en_route') primary = { title: "I've arrived", onPress: () => void s.arrive(job.id) };
  else if (job.status === 'arrived') primary = { title: 'Record delivery', onPress: () => router.push(`/complete/${job.id}`) };

  return (
    <Screen>
      <Stack.Screen options={{ title: `Job #${job.number}` }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ gap: 4 }}>
          <T size={26} weight="700">{job.site_label}</T>
          {job.customer_name !== job.site_label && <T size={18}>{job.customer_name}</T>}
          {job.site_address && <T muted>{job.site_address}</T>}
        </View>
        <Card>
          <T size={14} muted>Requested</T>
          <T size={28} weight="700">{job.requested_litres ? litres(job.requested_litres) : 'Fill to full'}</T>
          {job.priority === 2 && <T weight="700" color={t.danger}>Urgent: customer is out of water</T>}
        </Card>
        {job.site_access_notes && (
          <Card style={{ borderColor: t.warn }}>
            <T size={14} weight="600" color={t.warn}>Access notes</T>
            <T>{job.site_access_notes}</T>
          </Card>
        )}
        {job.notes && (
          <Card>
            <T size={14} weight="600" muted>From the office</T>
            <T>{job.notes}</T>
          </Card>
        )}
        {job.status === 'completed' ? (
          <Card style={{ borderColor: t.ok }}>
            <T weight="700" color={t.ok}>Delivered {litres(job.delivered_litres)} at {clock(job.completed_at)}</T>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {primary && <BigButton title={primary.title} onPress={primary.onPress} />}
            {job.status !== 'scheduled' && <BigButton kind="secondary" small title="Directions" onPress={directions} />}
            {job.status === 'en_route' && (
              <T size={14} muted style={{ textAlign: 'center' }}>Arrival is logged automatically when you reach the delivery point.</T>
            )}
            {job.customer_phone && (
              <BigButton kind="secondary" small title={`Call ${job.customer_phone}`} onPress={() => void Linking.openURL(`tel:${job.customer_phone}`)} />
            )}
          </View>
        )}
        <BigButton kind="secondary" small title={job.comment_count ? `Messages (${job.comment_count})` : 'Message the office'} onPress={() => router.push(`/chat/${job.id}`)} />
        <View style={{ gap: 2 }}>
          {job.started_at && <T size={14} muted>Started {clock(job.started_at)}</T>}
          {job.arrived_at && <T size={14} muted>Arrived {clock(job.arrived_at)}</T>}
        </View>
      </ScrollView>
    </Screen>
  );
}
