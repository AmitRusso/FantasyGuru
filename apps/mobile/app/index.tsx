import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { loadIdentity } from '../src/storage/identity';

/**
 * §4.2 of the design brief has been open since rev 1: does a Sleeper deep-link scheme exist?
 * "Test this on day one, not on day fourteen" -- this is the first stage where there is an
 * app on a device that can ask. Dev-only: it needs a physical Android device with Sleeper
 * installed to mean anything, and it answers a question, it isn't a feature.
 *
 * RECORD THE ANSWER in build-plan.md S3 §3.8 once run on a real device -- the result
 * reshapes the alarm (spec §4.2) and is a Stage 5/8 input, not just a Stage 3 curiosity.
 */
async function probeSleeperDeepLink(): Promise<void> {
  const candidates = ['sleeper://', 'https://sleeper.com/leagues/0'];
  const results = await Promise.all(
    candidates.map(async (url) => {
      try {
        return `${url} -> ${await Linking.canOpenURL(url)}`;
      } catch (error) {
        return `${url} -> ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
    }),
  );
  Alert.alert('Sleeper deep link probe', results.join('\n'));
}

/**
 * Artboard 01 -- Cold open (design-brief.md §5). One input, no password, no signup.
 * "This screen's entire purpose is to look like it will take ten seconds -- because it does"
 * (spec §2.1, measured against a real account in build-plan.md S2: 5.1s cold, 2.1s warm).
 *
 * A returning user never sees this screen (build-plan.md S3 Decision 5, DoD item 4): if an
 * identity is already stored, this redirects to /dashboard before rendering the form.
 */
export default function ColdOpen() {
  const [checkingStorage, setCheckingStorage] = useState(true);
  const [username, setUsername] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadIdentity().then((identity) => {
      if (cancelled) return;
      if (identity) {
        router.replace({ pathname: '/dashboard', params: { username: identity.username } });
        return;
      }
      setCheckingStorage(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingStorage) {
    // Deliberately blank rather than a spinner: for a returning user this frame is never
    // seen for more than a beat, and a spinner here would just be a flash before the
    // redirect above fires.
    return <View className="flex-1 bg-ground" />;
  }

  const trimmed = username.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 64;

  function submit() {
    if (!canSubmit) return;
    router.push({ pathname: '/dashboard', params: { username: trimmed } });
  }

  return (
    <View className="flex-1 bg-ground px-screen justify-center gap-8">
      <View className="gap-3">
        <Text className="font-display text-verdict text-text">FantasyGuru</Text>
        <Text className="font-body text-body text-text-2">
          Enter your Sleeper username. We'll show every league you're in — no password, no signup.
        </Text>
      </View>

      <View className="gap-4">
        <TextInput
          value={username}
          onChangeText={setUsername}
          onSubmitEditing={submit}
          placeholder="Sleeper username"
          // `placeholderTextColor` is a native style value, not a className NativeWind
          // compiles -- it cannot reference the CSS custom properties in global.css. Hardcoded
          // to the dark-theme text-3 value for now; Stage 7's full light/dark pass should
          // drive this from `useColorScheme()` instead.
          placeholderTextColor="#64717E"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          returnKeyType="go"
          className="font-body text-body text-text bg-surface border border-line rounded-lg px-4 py-3"
        />

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          className={`rounded-lg py-3 items-center ${canSubmit ? 'bg-accent' : 'bg-surface-raised'}`}
        >
          <Text
            className={`font-body-semibold text-body ${canSubmit ? 'text-ground' : 'text-text-3'}`}
          >
            Find my leagues
          </Text>
        </Pressable>

        {__DEV__ && (
          <Pressable onPress={() => void probeSleeperDeepLink()} className="py-2 items-center">
            <Text className="font-mono text-label uppercase text-text-3">
              Dev: probe Sleeper deep link
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
