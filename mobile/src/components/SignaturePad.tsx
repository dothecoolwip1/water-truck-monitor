import { forwardRef, useImperativeHandle, useRef, useState, type ComponentRef } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { T, useTheme } from './ui';

export interface SignatureHandle {
  isEmpty(): boolean;
  /** PNG file of the signature, or null if nothing was drawn. */
  capture(): Promise<string | null>;
}

/** Finger signature, drawn as vector strokes and saved as a PNG with the delivery. */
const SignaturePad = forwardRef<SignatureHandle, { onChange?: (empty: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const t = useTheme();
  const view = useRef<ComponentRef<typeof View>>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const live = useRef('');

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the page from scrolling while signing.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        live.current = `M${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
        setCurrent(live.current);
      },
      onPanResponderMove: (e) => {
        live.current += ` L${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
        setCurrent(live.current);
      },
      onPanResponderRelease: () => {
        const done = live.current;
        live.current = '';
        setCurrent('');
        setPaths((p) => [...p, done]);
        onChange?.(false);
      },
    }),
  ).current;

  useImperativeHandle(ref, () => ({
    isEmpty: () => paths.length === 0,
    capture: async () => (paths.length && view.current ? captureRef(view as never, { format: 'png', quality: 1, result: 'tmpfile' }) : null),
  }));

  return (
    <View style={{ gap: 6 }}>
      <View
        ref={view}
        collapsable={false}
        {...responder.panHandlers}
        style={{ height: 170, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: '#ffffff' }}
      >
        <Svg width="100%" height="100%">
          {[...paths, current].filter(Boolean).map((d, i) => (
            <Path key={i} d={d} stroke="#111" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
        {paths.length === 0 && !current && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 70, alignItems: 'center' }}>
            <T size={15} color="#888">Sign here</T>
          </View>
        )}
      </View>
      <Pressable onPress={() => { setPaths([]); onChange?.(true); }} hitSlop={10}>
        <T size={15} color={t.accent}>Clear signature</T>
      </Pressable>
    </View>
  );
});

export default SignaturePad;
