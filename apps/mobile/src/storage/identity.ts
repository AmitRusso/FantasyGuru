import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * build-plan.md S3 Decision 5: Sleeper usernames are mutable (spec §2.1's data-model
 * gotcha applies to the client exactly as it applies to the server's `users` table). The
 * identity persisted here is `sleeperUserId`; `username` is kept only for display on
 * relaunch, never as the lookup key.
 *
 * AsyncStorage, not expo-secure-store: a Sleeper user id is not a secret, and SecureStore's
 * size/reliability tradeoffs on Android are not worth paying for a public identifier.
 */

const STORAGE_KEY = 'fantasyguru.identity.v1';

export interface StoredIdentity {
  sleeperUserId: string;
  /** Display only. Never used to look the user up again -- see the gotcha above. */
  username: string;
}

export async function loadIdentity(): Promise<StoredIdentity | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'sleeperUserId' in parsed &&
      'username' in parsed &&
      typeof (parsed as StoredIdentity).sleeperUserId === 'string' &&
      typeof (parsed as StoredIdentity).username === 'string'
    ) {
      return parsed as StoredIdentity;
    }
    return null;
  } catch {
    // A corrupted value is a cold start, not a crash.
    return null;
  }
}

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export async function clearIdentity(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
