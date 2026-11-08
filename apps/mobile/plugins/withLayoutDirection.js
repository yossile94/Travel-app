/**
 * Sprint 14 F-044 (AC-6): the layout direction follows the device language,
 * set natively in Application.onCreate, before React starts.
 *
 * Why: the app speaks Hebrew or English only. React Native alone would turn on
 * RTL for any RTL device language (Arabic, Persian, Urdu) while the text is
 * English, and I18nManager.forceRTL from JS only takes effect after a restart
 * (no expo-updates to reload). So: Hebrew ("he", or "iw" on older Android) is
 * RTL, anything else is LTR, and the JS picks the language from
 * I18nManager.isRTL (src/i18n/language.ts), so text and layout always agree.
 *
 * expo-localization applies its own allowRTL/forceRTL in its module's OnCreate
 * the first time after its config options change (its "…SetByConfig"
 * preferences). Marking both as not set by config leaves the direction to us.
 * plugins/withLayoutDirection.test.js checks those keys against the installed
 * expo-localization.
 */
const { withMainApplication } = require('expo/config-plugins');

const MARKER = '// travel-app: layout direction from the device language';

const IMPORTS = [
  'import com.facebook.react.modules.i18nmanager.I18nUtil',
  'import java.util.Locale',
];

const DIRECTION = `    ${MARKER} (see plugins/withLayoutDirection.js)
    val hebrew = Locale.getDefault().language.let { it == "he" || it == "iw" }
    getSharedPreferences("expo.modules.localization", MODE_PRIVATE).edit()
      .putBoolean("supportsRTLSetByConfig", false)
      .putBoolean("forcesRTLSetByConfig", false)
      .apply()
    I18nUtil.instance.allowRTL(this, hebrew)
    I18nUtil.instance.forceRTL(this, hebrew)`;

function addDirection(contents) {
  if (contents.includes(MARKER)) return contents;

  const superCall = /^(\s*)super\.onCreate\(\)\s*$/m;
  if (!superCall.test(contents)) {
    throw new Error('withLayoutDirection: super.onCreate() not found in MainApplication.kt');
  }

  let next = contents.replace(superCall, (line) => `${line}\n${DIRECTION}`);
  const missing = IMPORTS.filter((i) => !next.includes(i));
  if (missing.length) {
    const lastImport = next.lastIndexOf('\nimport ');
    const endOfImport = next.indexOf('\n', lastImport + 1);
    next = `${next.slice(0, endOfImport)}\n${missing.join('\n')}${next.slice(endOfImport)}`;
  }
  return next;
}

const withLayoutDirection = (config) =>
  withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('withLayoutDirection expects a Kotlin MainApplication');
    }
    mod.modResults.contents = addDirection(mod.modResults.contents);
    return mod;
  });

module.exports = withLayoutDirection;
module.exports.addDirection = addDirection;
module.exports.MARKER = MARKER;
