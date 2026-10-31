import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const SERVER_KEY = 'wt.server';
const builtIn: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000';
let current = builtIn;

/** The server address. Built into the app, but changeable on the sign-in screen for testing. */
export async function loadServer(): Promise<string> {
  try {
    current = (await AsyncStorage.getItem(SERVER_KEY)) || builtIn;
  } catch {
    current = builtIn;
  }
  return current;
}

export function server(): string {
  return current;
}

export async function setServer(url: string): Promise<void> {
  current = url.trim().replace(/\/+$/, '') || builtIn;
  await AsyncStorage.setItem(SERVER_KEY, current);
}

export const BUILT_IN_SERVER = builtIn;
