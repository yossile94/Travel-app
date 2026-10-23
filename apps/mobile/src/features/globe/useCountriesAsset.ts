import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';

// Bundled as an asset (metro.config.js), never imported into the JS bundle:
// Mapbox reads the 1.4 MB file natively from a local file URL.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const COUNTRIES = require('../../../assets/geo/countries.geojson') as number;

/** Local file URL of the bundled country borders, once available. */
export function useCountriesAsset(): { url: string | null; error: Error | null } {
  const [state, setState] = useState<{ url: string | null; error: Error | null }>({
    url: null,
    error: null,
  });

  useEffect(() => {
    let mounted = true;
    Asset.fromModule(COUNTRIES)
      .downloadAsync()
      .then((asset) => {
        if (mounted) setState({ url: asset.localUri ?? asset.uri, error: null });
      })
      .catch((error: unknown) => {
        if (mounted)
          setState({ url: null, error: error instanceof Error ? error : new Error(String(error)) });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return state;
}
