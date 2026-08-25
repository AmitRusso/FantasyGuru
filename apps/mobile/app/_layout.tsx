import '../global.css';

import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts as useArchivo,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  useFonts as useIBMPlexSans,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from '@expo-google-fonts/ibm-plex-sans';
import {
  useFonts as useIBMPlexMono,
  IBMPlexMono_500Medium,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import * as SplashScreen from 'expo-splash-screen';

/**
 * Three faces, three jobs (design-brief.md §4.3): Archivo for the verdict and titles, IBM
 * Plex Sans for anything read as a sentence, IBM Plex Mono for labels and timestamps -- the
 * mono face doing the labelling work is deliberate, keeping the hierarchy pointed at the
 * verdict rather than at metadata.
 */

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [archivoLoaded] = useArchivo({ Archivo_600SemiBold, Archivo_700Bold });
  const [plexSansLoaded] = useIBMPlexSans({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  });
  const [plexMonoLoaded] = useIBMPlexMono({ IBMPlexMono_500Medium, IBMPlexMono_700Bold });

  const fontsReady = archivoLoaded && plexSansLoaded && plexMonoLoaded;

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) {
    // The native splash screen is still showing at this point (hideAsync only just fired
    // above), so this brief return is never actually painted -- it exists so the component
    // has a valid render for the frame between "fonts ready" and "splash hidden."
    return <View className="flex-1 bg-ground" />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
