const fs = require('fs');
const path = require('path');

const { addDirection } = require('./withLayoutDirection');

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

describe('withLayoutDirection', () => {
  it('sets the direction from the device language before React loads', () => {
    const out = addDirection(MAIN_APPLICATION);
    const sup = out.indexOf('super.onCreate()');
    const force = out.indexOf('I18nUtil.instance.forceRTL(this, hebrew)');
    const load = out.indexOf('loadReactNative(this)');
    expect(force).toBeGreaterThan(sup);
    expect(force).toBeLessThan(load);
    expect(out).toContain('I18nUtil.instance.allowRTL(this, hebrew)');
    // Older Android reports Hebrew as "iw".
    expect(out).toContain('it == "he" || it == "iw"');
  });

  it('adds the imports after the existing ones', () => {
    const out = addDirection(MAIN_APPLICATION);
    expect(out).toContain(
      'import expo.modules.ExpoReactHostFactory\nimport com.facebook.react.modules.i18nmanager.I18nUtil\nimport java.util.Locale',
    );
  });

  it('is idempotent', () => {
    const once = addDirection(MAIN_APPLICATION);
    expect(addDirection(once)).toBe(once);
  });

  it('fails loudly if the template changes', () => {
    expect(() => addDirection('class MainApplication {}')).toThrow(/super\.onCreate/);
  });

  it("matches the preference keys expo-localization reads, so it doesn't override us", () => {
    const module = path.join(
      path.dirname(require.resolve('expo-localization/package.json')),
      'android/src/main/java/expo/modules/localization/LocalizationModule.kt',
    );
    const source = fs.readFileSync(module, 'utf8');
    expect(source).toContain('getSharedPreferences("expo.modules.localization"');
    expect(source).toContain('resolveRTL("supportsRTLSetByConfig"');
    expect(source).toContain('resolveRTL("forcesRTLSetByConfig"');
    expect(source).toContain('getBoolean(key, true)');
  });
});
