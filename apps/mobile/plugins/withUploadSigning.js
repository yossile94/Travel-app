/**
 * Signs release builds with the Play upload key when the machine has one
 * (sprint 13 AC-16, ADR-020); otherwise with the debug key, as before.
 *
 * Why: Play App Signing needs every AAB signed with the same upload key. The
 * key and its passwords never enter Git: they live in the builder's
 * ~/.gradle/gradle.properties as TRAVELAPP_UPLOAD_STORE_FILE,
 * TRAVELAPP_UPLOAD_STORE_PASSWORD, TRAVELAPP_UPLOAD_KEY_ALIAS and
 * TRAVELAPP_UPLOAD_KEY_PASSWORD. A machine without them (CI, a teammate)
 * still builds, signed for debug.
 *
 * What: an "upload" signing config in app/build.gradle, filled only when the
 * properties are set, and the release build type picks it then.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// travel-app: Play upload signing (plugins/withUploadSigning.js)';

const UPLOAD = `        ${MARKER}
        upload {
            if (project.hasProperty('TRAVELAPP_UPLOAD_STORE_FILE')) {
                storeFile file(TRAVELAPP_UPLOAD_STORE_FILE)
                storePassword TRAVELAPP_UPLOAD_STORE_PASSWORD
                keyAlias TRAVELAPP_UPLOAD_KEY_ALIAS
                keyPassword TRAVELAPP_UPLOAD_KEY_PASSWORD
            } else if (gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }) {
                logger.warn('travel-app: no TRAVELAPP_UPLOAD_* in gradle.properties; the release is signed with the debug key (ADR-020)')
            }
        }`;

const RELEASE_PICK =
  "signingConfig project.hasProperty('TRAVELAPP_UPLOAD_STORE_FILE') ? signingConfigs.upload : signingConfigs.debug";

function addUploadSigning(contents) {
  if (contents.includes(MARKER)) return contents;
  const configs = /^ {4}signingConfigs \{\s*$/m;
  const release = /(^ {8}release \{[\s\S]*?^ {12})signingConfig signingConfigs\.debug\s*$/m;
  if (!configs.test(contents) || !release.test(contents)) {
    throw new Error(
      'withUploadSigning: app/build.gradle has no "signingConfigs {" block or no release signingConfig',
    );
  }
  return contents
    .replace(configs, (line) => `${line}\n${UPLOAD}`)
    .replace(release, (_, head) => `${head}${RELEASE_PICK}`);
}

const withUploadSigning = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = addUploadSigning(c.modResults.contents);
    return c;
  });

module.exports = withUploadSigning;
module.exports.addUploadSigning = addUploadSigning;
