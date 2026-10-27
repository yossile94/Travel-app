/**
 * Builds the app's native code under a short folder on Windows.
 *
 * Why: CMake and ninja write object files under
 * android/app/.cxx/<config>/<hash>/<abi>/ plus each source's absolute path.
 * For @rnmapbox/maps' codegen that passes Windows' 260-character limit even
 * from a short checkout, and the build fails with "mkdir: No such file or
 * directory" (sprint 6 day-1 trial, Raz 17). EAS builds on Linux are not
 * touched: the setting is added only when prebuild runs on Windows.
 *
 * What: externalNativeBuild.cmake.buildStagingDirectory in app/build.gradle,
 * pointing at %TRAVEL_APP_NATIVE_DIR% or C:/x.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// travel-app: short native build directory (plugins/withShortNativeBuildDir.js)';

function addStagingDir(contents, dir) {
  if (contents.includes(MARKER)) return contents;
  const android = /^android \{\s*$/m;
  if (!android.test(contents)) {
    throw new Error('withShortNativeBuildDir: no "android {" block in app/build.gradle');
  }
  const path = dir.replace(/\\/g, '/');
  return contents.replace(
    android,
    (line) =>
      `${line}\n    ${MARKER}\n    externalNativeBuild { cmake { buildStagingDirectory = file("${path}") } }`,
  );
}

const withShortNativeBuildDir = (config) =>
  process.platform !== 'win32'
    ? config
    : withAppBuildGradle(config, (c) => {
        c.modResults.contents = addStagingDir(
          c.modResults.contents,
          process.env.TRAVEL_APP_NATIVE_DIR || 'C:/x',
        );
        return c;
      });

module.exports = withShortNativeBuildDir;
module.exports.addStagingDir = addStagingDir;
