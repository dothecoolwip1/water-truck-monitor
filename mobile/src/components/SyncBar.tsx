import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../lib/store';
import { T, useTheme } from './ui';

/** Always-visible line telling the driver whether everything has reached the office. */
export default function SyncBar() {
  const s = useStore();
  const t = useTheme();
  const waiting = s.pending.filter((o) => o.type !== 'gps').length;
  let text: string;
  let color = t.ok;
  if (s.problems.length) {
    text = `${s.problems.length} item${s.problems.length > 1 ? 's' : ''} need attention. Tap to see.`;
    color = t.danger;
  } else if (waiting && !s.online) {
    text = `No signal. ${waiting} item${waiting > 1 ? 's' : ''} saved on this phone, will send when back in range.`;
    color = t.warn;
  } else if (waiting) {
    text = `Sending ${waiting} item${waiting > 1 ? 's' : ''}…`;
    color = t.warn;
  } else if (!s.online) {
    text = 'No signal. Showing the last copy of your jobs.';
    color = t.warn;
  } else {
    text = 'Everything sent to the office.';
  }
  return (
    <Pressable onPress={() => router.push('/settings')} accessibilityRole="button">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.card, borderBottomWidth: 1, borderColor: t.border }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
        <T size={14} style={{ flex: 1 }}>{text}</T>
      </View>
    </Pressable>
  );
}
