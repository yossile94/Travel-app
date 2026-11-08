# Sprint 14 AC-14: the Play AAB, test run

**Date:** 07.11.2026 (the build); recorded 08.11.2026. **Who:** Dori, for Dana's QA.

The release script `scripts/release/build-android.sh` was run on `origin/chore/s14-qa`
(version 0.14.1, versionCode 4, before the 0.15.0 bump), in `aab` mode, with a
throwaway upload key made for this test. The key was never committed and does not
belong to the store account.

```
bash scripts/release/build-android.sh origin/chore/s14-qa aab .qa/aab/travel-app-s14-test.aab
```

**Result:**
- The build finished in 44 minutes. The AAB is 137 MB and covers all ABIs.
- The script printed this signer:
  `Owner: CN=Travel App AAB test, O=test SHA1: B4:09:B4:91:2F:C0:25:05:CB:8D:33:A9:1A:22:4B:74:77:A8:DA:2C`.
- That fingerprint matches the test key's own SHA-1, from `keytool -list`.

**What's left before the store:** Yossi's real upload key, kept outside git. The script runs the same way with it, and Play App Signing holds the app signing key.

## Correction (08.11.2026)

The AAB from this test was built without the app's settings file (`apps/mobile/.env.local`). A clean checkout doesn't have that file, and the script didn't copy it in. So the bundle had no Mapbox token and no server address. The same happened to the first v0.15.0 APK, which on the phone showed "couldn't load the map".

**What the run still proves:** the signing and the script's flow.

**What it doesn't prove:** that a working app was built.

**The fix (`fix/release-env`):**
- The script copies the settings file in (`APP_ENV_FILE`).
- It stops if any of the four keys is missing.
- After the build it checks that the bundle contains the server address. It prints only key names, never values.

The v0.15.0 APK was rebuilt with the fix. The next AAB will be built the same way.
