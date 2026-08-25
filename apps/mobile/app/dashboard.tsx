import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { GetUserLeaguesResponse, LeagueSummary } from '@fantasyguru/contracts';
import { fetchUserLeagues } from '../src/api/client';
import { saveIdentity } from '../src/storage/identity';

/**
 * Artboards 02 (loading), 03 (home, rough) and part of 10 (empty/error), as one screen
 * managing a single data-fetch's states rather than as separate navigable routes -- they are
 * not destinations a user goes "back" to independently, they are what one request looks like
 * over time.
 *
 * No verdict block here: that is Stage 5's rule engine, which does not exist yet. This is
 * deliberately just the league list (build-plan.md S3 §3.3).
 */

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: GetUserLeaguesResponse }
  | { kind: 'not_found' }
  | { kind: 'invalid_username' }
  | { kind: 'warming_up' }
  | { kind: 'network_error' }
  | { kind: 'unknown_error' };

export default function Dashboard() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });

    const result = await fetchUserLeagues(username);

    switch (result.status) {
      case 'ok':
        await saveIdentity({ sleeperUserId: result.data.sleeperUserId, username });
        setState({ kind: 'ok', data: result.data });
        return;
      case 'not_found':
        setState({ kind: 'not_found' });
        return;
      case 'invalid_username':
        setState({ kind: 'invalid_username' });
        return;
      case 'warming_up':
        setState({ kind: 'warming_up' });
        return;
      case 'network_error':
        setState({ kind: 'network_error' });
        return;
      case 'unknown_error':
        setState({ kind: 'unknown_error' });
        return;
    }
  }, [username]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    // Honest, not simulated: the API is one request that does everything server-side
    // (resolve user, sync leagues, sync rosters), so there is no real intermediate progress
    // to report. Spec §4.5 asks for real progress over a shimmer -- a single accurate label
    // satisfies that better than inventing sub-steps the client cannot actually observe.
    // Measured against the deployed API (build-plan.md S2): 5.1s cold, 2.1s warm for an
    // 18-league account.
    return (
      <View className="flex-1 bg-ground items-center justify-center gap-4 px-screen">
        <ActivityIndicator color="#7FA3CC" />
        <Text className="font-body text-body text-text-2">Finding your leagues…</Text>
      </View>
    );
  }

  if (state.kind === 'ok') {
    if (state.data.leagues.length === 0) {
      // The normal state for a real person with no 2026 leagues yet -- not an error, and
      // not an empty white screen (design-brief.md §5 artboard 10 calls this out explicitly).
      return (
        <ErrorState
          title="No leagues yet"
          body="We didn't find any leagues on this account for the current season."
          onRetry={() => void load()}
        />
      );
    }

    return (
      <View className="flex-1 bg-ground px-screen pt-16">
        <Text className="font-display text-title text-text mb-6">Your leagues</Text>
        <FlatList
          data={state.data.leagues}
          keyExtractor={(league) => league.leagueId}
          ItemSeparatorComponent={() => <View className="h-px bg-line my-1" />}
          renderItem={({ item }) => <LeagueRow league={item} />}
        />
      </View>
    );
  }

  if (state.kind === 'not_found') {
    return (
      <ErrorState
        title="We couldn't find that username"
        body="Double-check the spelling and try again."
        onRetry={() => router.back()}
        retryLabel="Try a different username"
      />
    );
  }

  if (state.kind === 'invalid_username') {
    return (
      <ErrorState
        title="That username doesn't look right"
        body="Sleeper usernames are short — try again."
        onRetry={() => router.back()}
        retryLabel="Try a different username"
      />
    );
  }

  if (state.kind === 'warming_up') {
    return (
      <ErrorState
        title="Just a moment"
        body="The service is warming up. Try again in a few seconds."
        onRetry={() => void load()}
      />
    );
  }

  // network_error and unknown_error share the same copy: from here, an unreachable API and
  // an unexpected response look the same, and both point the user at the same next action.
  return (
    <ErrorState
      title="Can't reach Sleeper right now"
      body="Check your connection and try again."
      onRetry={() => void load()}
    />
  );
}

function LeagueRow({ league }: { league: LeagueSummary }) {
  return (
    <View className="py-4 gap-1">
      <Text className="font-body-semibold text-body text-text">{league.name}</Text>
      <Text className="font-mono text-label uppercase text-text-3">
        {league.totalRosters ?? '?'}-TEAM · {league.season}
      </Text>
    </View>
  );
}

function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = 'Try again',
}: {
  title: string;
  body: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <View className="flex-1 bg-ground items-center justify-center gap-4 px-screen">
      <Text className="font-display-semibold text-heading text-text text-center">{title}</Text>
      <Text className="font-body text-body text-text-2 text-center">{body}</Text>
      <Pressable onPress={onRetry} className="rounded-lg bg-surface-raised px-4 py-3 mt-2">
        <Text className="font-body-semibold text-body text-accent">{retryLabel}</Text>
      </Pressable>
    </View>
  );
}
