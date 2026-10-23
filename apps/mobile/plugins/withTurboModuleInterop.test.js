const { addInterop } = require('./withTurboModuleInterop');

const MAIN_APPLICATION = `package com.travelapp.companion

import android.app.Application
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;

describe('withTurboModuleInterop', () => {
  it('re-applies the stable flags with interop on, right after loadReactNative', () => {
    const out = addInterop(MAIN_APPLICATION);
    const load = out.indexOf('loadReactNative(this)');
    const override = out.indexOf('dangerouslyForceOverride');
    const lifecycle = out.indexOf('ApplicationLifecycleDispatcher');
    expect(load).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(load);
    expect(override).toBeLessThan(lifecycle);
    expect(out).toContain('override fun useTurboModuleInterop(): Boolean = true');
    expect(out).toContain('by ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()');
  });

  it('adds the imports after the existing ones', () => {
    const out = addInterop(MAIN_APPLICATION);
    expect(out).toContain(
      'import expo.modules.ExpoReactHostFactory\nimport com.facebook.react.internal.featureflags.ReactNativeFeatureFlags',
    );
  });

  it('is idempotent', () => {
    const once = addInterop(MAIN_APPLICATION);
    expect(addInterop(once)).toBe(once);
  });

  it('fails loudly if the template changes', () => {
    expect(() => addInterop('class MainApplication {}')).toThrow(/loadReactNative/);
  });
});
