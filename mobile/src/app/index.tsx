import { Redirect, router, Stack } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import SyncBar from '../components/SyncBar';
import { BigButton, Card, clock, litres, Screen, T, useTheme } from '../components/ui';
import { useStore } from '../lib/store';
import type { Job } from '../lib/types';

const STATUS: Record<Job['status'], string> = {
  requested: 'Requested',
  scheduled: 'To do',
  en_route: 'On the way',
  arrived: 'On site',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

export default function Today() {
  const s = useStore();
  const t = useTheme();
  if (!s.ready) return <Screen style={{ justifyContent: 'center' }}><ActivityIndicator /></Screen>;
  if (!s.user) return <Redirect href="/login" />;

  const open = s.jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled');
  const done = s.jobs.filter((j) => j.status === 'completed');
  const deliveredToday = done.reduce((sum, j) => sum + (j.delivered_litres ?? 0), 0);
  const active = open.find((j) => j.status === 'en_route' || j.status === 'arrived');
  const statusColor = (j: Job) => (j.status === 'completed' ? t.ok : j.status === 'en_route' || j.status === 'arrived' ? t.accent : t.muted);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: s.user.name.split(' ')[0] ? `Today · ${s.user.name.split(' ')[0]}` : 'Today',
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
              <T color={t.accent} weight="600">Menu</T>
            </Pressable>
          ),
        }}
      />
      <SyncBar />
      <FlatList
        data={s.shift ? open : []}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={s.syncing} onRefresh={s.refresh} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 6 }}>
            {s.shift ? (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <T weight="700">On duty · {s.shift.truck_name}</T>
                    <T size={14} muted>Since {clock(s.shift.started_at)} · {done.length} delivered · {litres(deliveredToday)}</T>
                  </View>
                  <Pressable onPress={() => router.push('/shift')} hitSlop={10}>
                    <T color={t.accent} weight="600">End shift</T>
                  </Pressable>
                </View>
              </Card>
            ) : (
              <Card style={{ gap: 12, paddingVertical: 20 }}>
                <T size={20} weight="700">You're off duty</T>
                <T muted>Go on duty to see today's jobs. Your location is shared with the office only while you're on duty.</T>
                <BigButton title="Go on duty" onPress={() => router.push('/shift')} />
              </Card>
            )}
            {s.shift && (
              <BigButton
                kind={s.fillStartedAt ? 'primary' : 'secondary'}
                small
                title={s.fillStartedAt ? 'Filling… tap when full' : 'Fill the truck'}
                onPress={() => router.push('/fill')}
              />
            )}
            {s.shift && active && <T size={14} weight="600" muted>CURRENT JOB</T>}
            {s.shift && !active && open.length > 0 && <T size={14} weight="600" muted>NEXT UP</T>}
          </View>
        }
        renderItem={({ item: j }) => (
          <Card onPress={() => router.push(`/job/${j.id}`)} style={j === active ? { borderColor: t.accent, borderWidth: 2 } : undefined}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T size={19} weight="700" style={{ flex: 1 }} numberOfLines={2}>{j.site_label}</T>
              <T size={14} weight="600" color={statusColor(j)}>{STATUS[j.status]}</T>
            </View>
            {j.customer_name !== j.site_label && <T muted>{j.customer_name}</T>}
            {j.site_address && <T size={14} muted numberOfLines={1}>{j.site_address}</T>}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
              <T weight="600">{j.requested_litres ? litres(j.requested_litres) : 'Fill to full'}</T>
              {j.priority === 2 && <T weight="700" color={t.danger}>URGENT</T>}
              {j.priority === 1 && <T weight="700" color={t.warn}>High priority</T>}
              <T size={14} muted>#{j.number}</T>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          s.shift ? (
            <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
              <T weight="600">No jobs left for today</T>
              <T muted>New jobs from the office will show up here.</T>
            </Card>
          ) : undefined
        }
        ListFooterComponent={
          s.shift && done.length > 0 ? (
            <View style={{ gap: 8, marginTop: 16 }}>
              <T size={14} weight="600" muted>DELIVERED TODAY</T>
              {done.map((j) => (
                <View key={j.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                  <T numberOfLines={1} style={{ flex: 1 }}>{j.site_label}</T>
                  <T weight="600">{litres(j.delivered_litres)}</T>
                  <T size={14} muted style={{ width: 70, textAlign: 'right' }}>{clock(j.completed_at)}</T>
                </View>
              ))}
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}
