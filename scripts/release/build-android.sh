#!/usr/bin/env bash
# Sprint 14 AC-14 (ADR-020): one script for the release builds.
#
#   scripts/release/build-android.sh <git ref> apk|aab <output file>
#
# - Builds from a clean checkout of <ref> in $BUILD_DIR (default C:/tb), so
#   the working tree is never what ships.
# - Firebase: $GOOGLE_SERVICES_JSON must point at google-services.json (it is
#   never in Git).
# - apk: arm64 only, for installing on a phone. Signed with the upload key
#   when ~/.gradle/gradle.properties has TRAVELAPP_UPLOAD_*, otherwise with
#   the debug key ($DEBUG_KEYSTORE, so updates install over the current app).
# - aab: every ABI, for Google Play. It must be signed with the upload key:
#   without it the script stops, since Play refuses a debug-signed bundle.
# - $GRADLE_EXTRA is passed to Gradle as is (a test key's -P properties).
# - The app's settings: $APP_ENV_FILE (default: apps/mobile/.env.local of the
#   main checkout) is copied in, since a clean checkout has none; the build
#   stops if it is missing a key, and checks the bundle has the server in it.
#   v0.15.0 first shipped without it: no map and no server (Raz/Dana, 08.11).
# The signing certificate's SHA-1 is printed at the end, to check against
# the upload key (ADR-020).
set -euo pipefail
export MSYS_NO_PATHCONV=1

ref=${1:?git ref}
kind=${2:?apk or aab}
out=${3:?output file}
build_dir=${BUILD_DIR:-C:/tb}
: "${GOOGLE_SERVICES_JSON:?GOOGLE_SERVICES_JSON must point at google-services.json}"
case "$kind" in apk | aab) ;; *) echo "kind must be apk or aab" >&2; exit 2 ;; esac
env_file=${APP_ENV_FILE:-C:/Users/HP/Travelapp/apps/mobile/.env.local}
REQUIRED_ENV=(EXPO_PUBLIC_MAPBOX_TOKEN EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_KEY EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
if [[ ! -f "$env_file" ]]; then
  echo "No app settings file at $env_file (APP_ENV_FILE): the app would ship with no map and no server." >&2
  exit 4
fi
# Names only: the values are never printed.
for key in "${REQUIRED_ENV[@]}"; do
  if ! grep -qE "^$key=.+" "$env_file"; then
    echo "$env_file has no value for $key" >&2
    exit 4
  fi
done

gradle_props="$HOME/.gradle/gradle.properties"
has_upload=false
if grep -q '^TRAVELAPP_UPLOAD_STORE_FILE=' "$gradle_props" 2>/dev/null ||
  [[ "${GRADLE_EXTRA:-}" == *TRAVELAPP_UPLOAD_STORE_FILE* ]]; then
  has_upload=true
fi
if [[ "$kind" == aab && "$has_upload" != true ]]; then
  echo "No upload key (TRAVELAPP_UPLOAD_* in $gradle_props): Play refuses a debug-signed AAB. See ADR-020." >&2
  exit 3
fi

start=$(date +%s)
cd "$build_dir"
git fetch -q origin --tags
git checkout -q --force "$ref"
git clean -qfdx -e node_modules
echo "== $(git log --oneline -1)"
npm ci --no-audit --no-fund --loglevel=error
cd apps/mobile
cp "$env_file" .env.local
unset EXPO_PUBLIC_PERF_LOG || true
npx expo prebuild -p android --clean --no-install
if [[ "$has_upload" != true && -n "${DEBUG_KEYSTORE:-}" ]]; then
  cp "$DEBUG_KEYSTORE" android/app/debug.keystore
fi
cd android
# shellcheck disable=SC2086
if [[ "$kind" == apk ]]; then
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a ${GRADLE_EXTRA:-} --console=plain -q
  built=app/build/outputs/apk/release/app-release.apk
else
  ./gradlew bundleRelease ${GRADLE_EXTRA:-} --console=plain -q
  built=app/build/outputs/bundle/release/app-release.aab
fi
# The bundle must carry the settings (the server's host, never printed).
bundle=app/build/generated/assets/react/release/index.android.bundle
host=$(grep -E "^EXPO_PUBLIC_SUPABASE_URL=" "$env_file" | cut -d= -f2- | sed -E "s#^https?://##; s#/.*##")
if ! grep -qF "$host" "$bundle"; then
  echo "The JS bundle has no server address: the settings did not reach the build." >&2
  exit 5
fi
mkdir -p "$(dirname "$out")"
cp "$built" "$out"
keytool=${KEYTOOL:-"C:/Program Files/Android/Android Studio/jbr/bin/keytool.exe"}
apksigner=${APKSIGNER:-"C:/Users/HP/AppData/Local/Android/Sdk/build-tools/37.0.0/apksigner.bat"}
echo "== signed by:"
if [[ "$kind" == apk ]]; then
  # An APK signed with v2 only has no JAR signature for keytool to read.
  cmd //c "$apksigner" verify --print-certs "$out" | grep -E 'DN:|SHA-1' | head -2 || true
else
  "$keytool" -printcert -jarfile "$out" | grep -E 'Owner:|SHA1:' | head -2 || true
fi
echo "== $out ($(du -h "$out" | cut -f1)) in $(( ($(date +%s) - start) / 60 )) min"
