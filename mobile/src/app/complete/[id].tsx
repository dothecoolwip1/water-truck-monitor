import { useMemo, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import SignaturePad, { type SignatureHandle } from '../../components/SignaturePad';
import { BigButton, Card, Field, litres, parseNum, Screen, T, useTheme } from '../../components/ui';
import { currentPosition } from '../../lib/location';
import { discard, keep, takeMeterPhoto } from '../../lib/photos';
import { useStore } from '../../lib/store';
import type { FormField, FormValue, PhotoRef } from '../../lib/types';

export default function CompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStore();
  const t = useTheme();
  const job = s.jobs.find((j) => j.id === id);
  const sig = useRef<SignatureHandle>(null);
  const [scrollOn, setScrollOn] = useState(true);

  // The truck meter keeps counting up, so this delivery starts where the last one ended.
  const lastMeter = useMemo(() => {
    const truck = s.today?.trucks.find((tr) => tr.id === s.shift?.truck_id);
    let m = truck?.last_meter_reading ?? s.shift?.start_meter ?? null;
    for (const op of s.pending) {
      if (op.type === 'job_complete' && op.meter_end != null) m = Math.max(m ?? 0, op.meter_end);
    }
    return m;
  }, [s.today, s.shift, s.pending]);

  const [meterStart, setMeterStart] = useState(lastMeter != null ? String(lastMeter) : '');
  const [meterEnd, setMeterEnd] = useState('');
  const [litresText, setLitresText] = useState('');
  const [litresTouched, setLitresTouched] = useState(false);
  const [photo, setPhoto] = useState<PhotoRef | null>(null);
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = s.today?.form_fields ?? [];
  const [answers, setAnswers] = useState<Record<string, FormValue>>({});

  if (!job) return <Screen style={{ padding: 16 }}><T>Job not found.</T></Screen>;

  const start = parseNum(meterStart);
  const end = parseNum(meterEnd);
  const fromMeter = start != null && end != null && end >= start ? Math.round((end - start) * 10) / 10 : null;
  const shownLitres = litresTouched ? litresText : fromMeter != null ? String(fromMeter) : litresText;
  const value = parseNum(shownLitres);
  const meterBackwards = start != null && end != null && end < start;

  async function snap() {
    try {
      const p = await takeMeterPhoto();
      if (p) {
        discard(photo);
        setPhoto(p);
      }
    } catch (e) {
      Alert.alert('Camera', (e as Error).message);
    }
  }

  async function save() {
    if (value === null || value < 0) return Alert.alert('Litres needed', 'Enter how many litres went into the tank.');
    if (meterBackwards) return Alert.alert('Check the meter', 'The end reading is lower than the start reading.');
    const missing = fields.find((f) => f.required && (answers[f.key] === undefined || answers[f.key] === null || answers[f.key] === ''));
    if (missing) return Alert.alert('Checklist', `Please answer "${missing.label}".`);
    const proceed = async () => {
      setBusy(true);
      try {
        const sigFile = await sig.current?.capture();
        const signature = sigFile ? keep(sigFile, 'image/png') : null;
        const pos = await currentPosition();
        await s.complete(job!.id, {
          litres: value,
          meter_start: start,
          meter_end: end,
          recipient_name: recipient.trim() || null,
          notes: notes.trim() || null,
          meter_photo: photo,
          signature,
          lat: pos?.lat ?? null,
          lng: pos?.lng ?? null,
          form_data: fields.length ? answers : null,
        });
        router.dismissTo('/');
      } catch (e) {
        Alert.alert('Could not save', (e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    const big = job!.requested_litres && value > job!.requested_litres * 1.5;
    const confirmText = `${litres(value)} to ${job!.site_label}${big ? `\n\nThat's much more than the ${litres(job!.requested_litres)} requested.` : ''}${!photo ? '\n\nNo meter photo was taken.' : ''}`;
    Alert.alert('Save delivery?', confirmText, [{ text: 'Go back', style: 'cancel' }, { text: 'Save', onPress: () => void proceed() }]);
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" scrollEnabled={scrollOn}>
          <T size={20} weight="700">{job.site_label}</T>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label="Meter start" value={meterStart} onChangeText={setMeterStart} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Meter end" value={meterEnd} onChangeText={setMeterEnd} keyboardType="decimal-pad" autoFocus />
            </View>
          </View>
          {meterBackwards && <T color={t.danger}>End reading is lower than start.</T>}
          <Field
            label="Litres delivered"
            value={shownLitres}
            onChangeText={(v) => { setLitresTouched(true); setLitresText(v); }}
            keyboardType="decimal-pad"
            style={{ fontSize: 28, fontWeight: '700', minHeight: 68 }}
            hint={fromMeter != null && !litresTouched ? 'Worked out from the meter readings.' : undefined}
          />

          <Card style={{ gap: 10 }}>
            <T weight="600">Photo of the meter</T>
            {photo ? <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 220, borderRadius: 8 }} resizeMode="cover" /> : null}
            <BigButton kind={photo ? 'secondary' : 'primary'} small title={photo ? 'Retake photo' : 'Take photo'} onPress={snap} />
          </Card>

          {fields.length > 0 && (
            <Card style={{ gap: 14 }}>
              <T weight="700">Checklist</T>
              {fields.map((f) => (
                <Question key={f.key} field={f} value={answers[f.key]} onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))} />
              ))}
            </Card>
          )}

          <Field label="Received by (optional)" value={recipient} onChangeText={setRecipient} autoCapitalize="words" style={{ fontSize: 18 }} />
          <View
            onTouchStart={() => setScrollOn(false)}
            onTouchEnd={() => setScrollOn(true)}
            onTouchCancel={() => setScrollOn(true)}
          >
            <T size={14} weight="600" muted style={{ marginBottom: 6 }}>Signature (optional)</T>
            <SignaturePad ref={sig} />
          </View>
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline style={{ fontSize: 17, minHeight: 80, textAlignVertical: 'top', paddingTop: 12 }} />
          <BigButton title="Save delivery" onPress={save} busy={busy} disabled={value === null} />
          <T size={13} muted style={{ textAlign: 'center' }}>Saved on the phone first, then sent to the office when there's signal.</T>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** One checklist question, sized for gloves: big tap targets, no tiny pickers. */
function Question({ field, value, onChange }: { field: FormField; value: FormValue | undefined; onChange: (v: FormValue) => void }) {
  const t = useTheme();
  const label = `${field.label}${field.required ? '' : ' (optional)'}`;
  if (field.type === 'text' || field.type === 'number') {
    return (
      <Field label={label} value={value == null ? '' : String(value)} keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
        onChangeText={(v) => onChange(field.type === 'number' ? parseNum(v) : v)} style={{ fontSize: 18 }} />
    );
  }
  const options = field.type === 'yesno' ? [{ v: true, l: 'Yes' }, { v: false, l: 'No' }] : (field.options ?? []).map((o) => ({ v: o, l: o }));
  return (
    <View style={{ gap: 8 }}>
      <T size={15} weight="600">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = value === o.v;
          return (
            <Pressable key={String(o.v)} onPress={() => onChange(on ? null : o.v)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ minHeight: 48, minWidth: 88, paddingHorizontal: 16, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
                borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : t.card }}>
              <T weight="700" color={on ? t.accentText : t.text}>{o.l}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
