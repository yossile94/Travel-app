/**
 * Turns on React Native's legacy-module interop on Android.
 *
 * Why: in React Native 0.88 the new architecture no longer exposes legacy
 * native modules by default (ReactNativeFeatureFlags.useTurboModuleInterop()
 * is false outside the canary release level). @rnmapbox/maps 10.3.11 still
 * registers RNMBXModule as a legacy module (isTurboModule = false), so its JS
 * finds NativeModules.RNMBXModule == null and throws "native code not
 * available" even though the native library is in the app.
 *
 * What: right after loadReactNative() (which applies the stable flag set) and
 * before the React host creates its module manager, re-apply the stable flags
 * with only useTurboModuleInterop switched on.
 *
 * Remove when @rnmapbox/maps registers RNMBXModule as a TurboModule.
 * See docs/decisions/ADR-002-globe-and-map-data.md.
 */
const { withMainApplication } = require('expo/config-plugins');

const MARKER = '// travel-app: enable TurboModule interop';

const IMPORTS = [
  'import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags',
  'import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android',
  'import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider',
];

const OVERRIDE = `    ${MARKER} (@rnmapbox/maps RNMBXModule is a legacy module; see plugins/withTurboModuleInterop.js)
    ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : ReactNativeFeatureFlagsProvider by ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android() {
        override fun useTurboModuleInterop(): Boolean = true
      }
    )`;

function addInterop(contents) {
  if (contents.includes(MARKER)) return contents;

  const loadCall = /^(\s*)loadReactNative\(this\)\s*$/m;
  if (!loadCall.test(contents)) {
    throw new Error(
      'withTurboModuleInterop: loadReactNative(this) not found in MainApplication.kt',
    );
  }

  let next = contents.replace(loadCall, (line) => `${line}\n${OVERRIDE}`);
  const lastImport = next.lastIndexOf('\nimport ');
  const endOfImport = next.indexOf('\n', lastImport + 1);
  next = `${next.slice(0, endOfImport)}\n${IMPORTS.join('\n')}${next.slice(endOfImport)}`;
  return next;
}

const withTurboModuleInterop = (config) =>
  withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('withTurboModuleInterop expects a Kotlin MainApplication');
    }
    mod.modResults.contents = addInterop(mod.modResults.contents);
    return mod;
  });

module.exports = withTurboModuleInterop;
module.exports.addInterop = addInterop;
