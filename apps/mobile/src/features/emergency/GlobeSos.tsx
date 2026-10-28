/**
 * Sprint 8 design 13.2, 14: the SOS button over the globe and the screen it
 * opens. Shown exactly when "My trips" is, and only with an active trip
 * (AC-15). The destination comes from sosTarget alone, never from the
 * country selected on the globe (spec 5.6). Flights and insurance of the
 * active trips are read from memory or the device copy: works offline.
 */
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Flight } from '@/features/flights/flightModel';
import { flightsForTrips, useFlightsVersion } from '@/features/flights/flightsStore';
import type { Insurance } from '@/features/kit/kitModel';
import { kitsOf } from '@/features/kit/kitStore';
import { useTrips } from '@/features/trips/TripsProvider';
import type { ColorScheme } from '@/theme/tokens';

import { SosButton, SosScreen } from './EmergencyViews';
import { activeTrips, pickerOrder, sosTarget } from './sosTarget';

/** layout.tripsButton.bottom (16) + its height (48) + 12 (design 14.2). */
const ABOVE_TRIPS_BUTTON = 76;

export function GlobeSos({ visible, colorScheme }: { visible: boolean; colorScheme: ColorScheme }) {
  const trips = useTrips();
  const insets = useSafeAreaInsets();
  const active = activeTrips(trips.cache?.upcoming ?? [], trips.today);
  const ids = active.map((t) => t.id).join(',');
  const [flights, setFlights] = useState<Map<string, Flight[]>>(new Map());
  const [insurance, setInsurance] = useState<Map<string, Insurance | null>>(new Map());
  const [open, setOpen] = useState(false);
  const flightsVersion = useFlightsVersion();

  useEffect(() => {
    if (!ids) return;
    const list = ids.split(',');
    let live = true;
    void flightsForTrips(list).then((m) => live && setFlights(m));
    void kitsOf(list).then(
      (m) => live && setInsurance(new Map([...m].map(([k, v]) => [k, v.insurance]))),
    );
    return () => {
      live = false;
    };
  }, [ids, trips.changes, open, flightsVersion]);

  const target = sosTarget(active, (id) => flights.get(id) ?? [], trips.today);
  if (!target) return null;
  return (
    <>
      {visible ? (
        <SosButton
          trip={target}
          bottom={insets.bottom + ABOVE_TRIPS_BUTTON}
          onPress={() => setOpen(true)}
        />
      ) : null}
      {open ? (
        <SosScreen
          adm0={target.countryAdm0}
          trip={target}
          choices={pickerOrder(active, target)}
          insuranceOf={(id) => insurance.get(id) ?? null}
          signedIn
          colorScheme={colorScheme}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
