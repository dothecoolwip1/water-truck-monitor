import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { BigButton, Card, clock, Field, parseNum, Screen, T } from '../components/ui';
import { useStore } from '../lib/store';

/**
 * A fill at the bulk tank. The office works out how much was loaded from
 * the tank sensor between "start" and "full"; the driver's number is a check.
 */
export default function FillScreen() {
  const s = useStore();
  const [litresText, setLitresText] = useState('');
  const [tankId, setTankId] = useState<string | null>(s.today?.tanks[0]?.id ?? null);
  const [now, setNow] = useState(Date.now());
  const tanks = s.today?.tanks ?? [];

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!s.shift) return <Screen style={{ padding: 16 }}><T>Go on duty before filling the truck.</T></Screen>;

  if (!s.fillStartedAt) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <T size={22} weight="700">Filling {s.shift.truck_name}</T>
          <T muted>Tap start when the water begins to flow, and finish when the truck is full.</T>
          {tanks.length > 1 && tanks.map((tk) => (
            <BigButton key={tk.id} small kind={tk.id === tankId ? 'primary' : 'secondary'} title={tk.name} onPress={() => setTankId(tk.id)} />
          ))}
          <BigButton title="Start filling" onPress={() => void s.beginFill()} />
        </ScrollView>
      </Screen>
    );
  }

  const secs = Math.max(0, Math.round((now - new Date(s.fillStartedAt).getTime()) / 1000));
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
          <T muted>Filling since {clock(s.fillStartedAt)}</T>
          <T size={40} weight="700">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</T>
        </Card>
        <Field label="Litres loaded, from the truck meter (optional)" value={litresText} onChangeText={setLitresText} keyboardType="decimal-pad" />
        <BigButton
          title="Truck is full"
          onPress={async () => {
            await s.finishFill(parseNum(litresText), tankId);
            router.back();
          }}
        />
        <View style={{ height: 8 }} />
        <BigButton
          small
          kind="danger"
          title="Cancel this fill"
          onPress={() =>
            Alert.alert('Cancel the fill?', 'Nothing will be recorded.', [
              { text: 'Keep filling', style: 'cancel' },
              { text: 'Cancel fill', style: 'destructive', onPress: () => void s.cancelFill().then(() => router.back()) },
            ])
          }
        />
      </ScrollView>
    </Screen>
  );
}
