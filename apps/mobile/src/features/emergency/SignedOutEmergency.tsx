/**
 * Sprint 8 AC-17, design 15: signed out, the country card's "Emergency in
 * [country]" row opens the SOS screen from the bundled data, with no
 * insurance group and no picker. Signed in, emergency lives in the trip.
 */
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthIfAny } from '@/features/auth/AuthProvider';
import type { ColorScheme } from '@/theme/tokens';

import { CardEmergencyLink, SosScreen } from './EmergencyViews';

function SignedOutSos({
  adm0,
  colorScheme,
  onClose,
}: {
  adm0: string;
  colorScheme: ColorScheme;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <SosScreen
      adm0={adm0}
      trip={null}
      insuranceOf={() => null}
      signedIn={false}
      colorScheme={colorScheme}
      insetsTop={insets.top}
      insetsBottom={insets.bottom}
      onClose={onClose}
    />
  );
}

export function SignedOutEmergency({
  adm0,
  colorScheme,
}: {
  adm0: string;
  colorScheme: ColorScheme;
}) {
  const auth = useAuthIfAny();
  const [open, setOpen] = useState(false);
  if (auth?.state.status !== 'signedOut') return null;
  return (
    <>
      <CardEmergencyLink adm0={adm0} colorScheme={colorScheme} onPress={() => setOpen(true)} />
      {open ? (
        <SignedOutSos adm0={adm0} colorScheme={colorScheme} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
