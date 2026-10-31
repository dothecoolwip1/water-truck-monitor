import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { newId } from './queue';
import type { PhotoRef } from './types';

function keepDir(): Directory {
  const dir = new Directory(Paths.document, 'pending-photos');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Opens the camera and keeps a compressed copy safe on the phone until it syncs. */
export async function takeMeterPhoto(): Promise<PhotoRef | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission is off. Turn it on in Settings to photograph the meter.');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
  if (res.canceled || !res.assets[0]) return null;
  const ref = await ImageManipulator.manipulate(res.assets[0].uri).resize({ width: 1280 }).renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
  return keep(saved.uri, 'image/jpeg');
}

/** Moves a temporary file (camera shot, signature capture) somewhere the OS won't clear. */
export function keep(uri: string, mime: PhotoRef['mime']): PhotoRef {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const dest = new File(keepDir(), `${newId()}.${ext}`);
  new File(uri).copySync(dest);
  return { uri: dest.uri, mime };
}

export function discard(p: PhotoRef | null | undefined) {
  if (!p) return;
  try {
    const f = new File(p.uri);
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}
