import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { getAdminSyncStatus, subscribeAdminSync } from '@/lib/admin-sync';

/**
 * The customer's own photo: taken or chosen when they create their account, changed later on the User screen.
 * A copy stays on the phone (shown on the User screen), and it is sent to the shop, which shows it to its staff
 * under App Users. Sending is retried each time the phone is linked to the shop again, until it gets through.
 */
export type ProfilePhoto = { uri: string; mimeType: string };
type Saved = ProfilePhoto & { sent: boolean };

const KEY = 'vimalnath:profile-photo';
let saved: Saved | null | undefined;
let sending: Promise<void> | undefined;
const listeners = new Set<() => void>();

async function load(): Promise<Saved | null> {
  if (saved !== undefined) return saved;
  try {
    const text = await AsyncStorage.getItem(KEY);
    saved = text ? (JSON.parse(text) as Saved) : null;
  } catch {
    saved = null;
  }
  return saved;
}

async function store(next: Saved | null) {
  saved = next;
  await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  listeners.forEach((listener) => listener());
}

/** Opens the camera (front-facing) or the photo library, cropped square. Null when the person cancels. */
export async function pickProfilePhoto(source: 'camera' | 'library'): Promise<ProfilePhoto | null> {
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Allow camera access for Vimalnath in your phone’s Settings, or choose a photo instead.');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' } : null;
}

/** Keeps the photo on the phone (the picker's copy can be cleared), then sends it to the shop. */
export async function saveProfilePhoto(photo: ProfilePhoto): Promise<void> {
  const previous = await load();
  let uri = photo.uri;
  if (Platform.OS !== 'web') {
    const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
    // A new name each time, so the screens never show the old photo from an image cache.
    const target = new File(Paths.document, `profile-photo-${Date.now()}.${extension}`);
    await new File(photo.uri).copy(target);
    uri = target.uri;
    if (previous && previous.uri !== uri) {
      try {
        const old = new File(previous.uri);
        if (old.exists) old.delete();
      } catch {
        // Already gone.
      }
    }
  }
  await store({ uri, mimeType: photo.mimeType, sent: false });
  await sendProfilePhoto().catch(() => {});
}

/** Sends the saved photo if the shop doesn't have it yet. Throws if it can't, so a caller can say so. */
export function sendProfilePhoto(): Promise<void> {
  if (!sending) {
    sending = (async () => {
      const photo = await load();
      const { connection } = getAdminSyncStatus();
      if (!photo || photo.sent || !connection.enabled || !connection.deviceToken) return;
      const body = await (await fetch(photo.uri)).blob();
      const response = await fetch(`${connection.baseUrl}/v1/app/photo`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${connection.deviceToken}`, 'Content-Type': photo.mimeType },
        body,
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(failure?.error?.message ?? `The shop server returned ${response.status}.`);
      }
      // Only if it's still the same photo: a newer one chosen meanwhile still has to go.
      if (saved?.uri === photo.uri) await store({ ...photo, sent: true });
    })().finally(() => {
      sending = undefined;
    });
  }
  return sending;
}

/** Retries a photo that hasn't reached the shop whenever the phone is linked to it. Call once at startup. */
export function startProfilePhotoSync() {
  void sendProfilePhoto().catch(() => {});
  return subscribeAdminSync((status) => {
    if (status.connected && saved && !saved.sent) void sendProfilePhoto().catch(() => {});
  });
}

/** Forgets the photo on this phone, e.g. when the account logs out. */
export async function clearProfilePhoto(): Promise<void> {
  const previous = await load();
  if (previous && Platform.OS !== 'web') {
    try {
      const old = new File(previous.uri);
      if (old.exists) old.delete();
    } catch {
      // Already gone.
    }
  }
  await store(null);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (saved === undefined) void load().then(() => listeners.forEach((each) => each()));
  return () => {
    listeners.delete(listener);
  };
};

/** The photo saved on this phone, for the User screen. */
export function useProfilePhoto(): string | null {
  return useSyncExternalStore(subscribe, () => saved?.uri ?? null, () => null);
}
