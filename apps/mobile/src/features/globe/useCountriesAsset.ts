import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';

// Bundled as assets (metro.config.js), never imported into the JS bundle:
// Mapbox reads these files natively from local file URLs.
/* eslint-disable @typescript-eslint/no-require-imports */
const COUNTRIES = require('../../../assets/geo/countries.geojson') as number;
const COUNTRIES_DETAILED = require('../../../assets/geo/countries-detailed.geojson') as number;
const OCEAN_MASK = require('../../../assets/geo/ocean-mask.geojson') as number;
/* eslint-enable @typescript-eslint/no-require-imports */

export interface GeoAsset {
  url: string | null;
  error: Error | null;
}

/** Local file URL of a bundled geo file, once available; nothing is loaded until `enabled`. */
function useGeoAsset(module: number, enabled = true): GeoAsset {
  const [state, setState] = useState<GeoAsset>({ url: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    Asset.fromModule(module)
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
  }, [module, enabled]);

  return state;
}

/** Coarse country borders: needed for the first frame. */
export function useCountriesAsset(): GeoAsset {
  return useGeoAsset(COUNTRIES);
}

/** Sea tint mask, with the same coastline as the coarse borders (sprint 1 AC-8). */
export function useOceanMaskAsset(): GeoAsset {
  return useGeoAsset(OCEAN_MASK);
}

/** Detailed borders: only once the globe is ready, never in the first frame (AC-13a). */
export function useDetailedCountriesAsset(enabled: boolean): GeoAsset {
  return useGeoAsset(COUNTRIES_DETAILED, enabled);
}
