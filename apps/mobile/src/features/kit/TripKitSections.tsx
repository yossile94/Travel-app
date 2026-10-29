/**
 * Sprint 8 design 2.1: the travel kit in an open trip row, after the flights:
 * hotels, insurance, then "Emergency in [country]". Read when the row opens
 * and when the app comes back; offline from the encrypted device copy.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmergencyCard, SosScreen } from '@/features/emergency/EmergencyViews';
import type { ColorScheme } from '@/theme/tokens';

import { ItinerarySection, PlacesSection } from '@/features/itinerary/KitSections';
import type { Trip } from '@/features/trips/tripsApi';
import { HotelsSection } from './HotelsSection';
import { InsuranceSection } from './InsuranceSection';
import { refreshTripKit, useTripKit } from './kitStore';

export function TripKitSections({
  trip,
  readOnly,
  today,
  colorScheme,
  onToast,
}: {
  trip: Trip;
  readOnly: boolean;
  /** Sprint 11: today, for the itinerary section. */
  today: string;
  colorScheme: ColorScheme;
  onToast: (text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const kit = useTripKit(trip.id);
  const [sos, setSos] = useState(false);
  const offline = readOnly || kit.fromCache;

  useEffect(() => {
    void refreshTripKit(trip.id);
    const sub = AppState.addEventListener(
      'change',
      (s) => s === 'active' && void refreshTripKit(trip.id),
    );
    return () => sub.remove();
  }, [trip.id]);

  return (
    <>
      <HotelsSection
        trip={trip}
        hotels={kit.hotels}
        insurance={kit.insurance}
        status={kit.status}
        offline={offline}
        colorScheme={colorScheme}
        onToast={onToast}
      />
      {/* Sprint 11 design 2.2: the itinerary and "what to see" after the hotels. */}
      <ItinerarySection
        trip={trip}
        today={today}
        offline={offline}
        colorScheme={colorScheme}
        onToast={onToast}
      />
      <PlacesSection
        trip={trip}
        today={today}
        hasHotels={kit.hotels.length > 0}
        colorScheme={colorScheme}
        onToast={onToast}
      />
      <InsuranceSection
        trip={trip}
        insurance={kit.insurance}
        status={kit.status}
        offline={offline}
        colorScheme={colorScheme}
        onToast={onToast}
      />
      <EmergencyCard trip={trip} colorScheme={colorScheme} onOpenAll={() => setSos(true)} />
      {sos ? (
        <SosScreen
          adm0={trip.countryAdm0}
          trip={trip}
          insuranceOf={() => kit.insurance}
          signedIn
          colorScheme={colorScheme}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setSos(false)}
        />
      ) : null}
    </>
  );
}
