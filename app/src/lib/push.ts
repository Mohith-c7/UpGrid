import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '@/api/client';

let currentToken: string | null = null;
let configured = false;

/** Safe to call repeatedly. Foreground notifications show as a banner and in the list. */
export function configureNotifications(): void {
  if (configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    /* unsupported environment (e.g. Expo Go on some SDKs) */
  }
}

/** Ask for permission, fetch the Expo push token and register it with the API. Never throws. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    if (Constants.appOwnership === 'expo') return null; // remote push is unavailable in Expo Go
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Drive reminders and updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#126B63',
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return null;
    const projectId: string | undefined =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return null;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return null;
    await api.post('/devices', { expoPushToken: token, platform: Platform.OS });
    currentToken = token;
    return token;
  } catch {
    return null;
  }
}

/** Call before clearing the session so this device stops receiving pushes for the account. */
export async function unregisterPush(): Promise<void> {
  try {
    await api.delete('/devices', currentToken ? { expoPushToken: currentToken } : undefined);
  } catch {
    /* best effort */
  }
  currentToken = null;
}
