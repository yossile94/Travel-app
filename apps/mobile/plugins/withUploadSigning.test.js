const { addUploadSigning } = require('./withUploadSigning');

// The shape Expo SDK 58's prebuild writes (android/app/build.gradle).
const GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
        }
    }
}
`;

describe('withUploadSigning (sprint 13 AC-16, ADR-020)', () => {
  it('adds the upload config, filled only from gradle properties, and release picks it', () => {
    const out = addUploadSigning(GRADLE);
    expect(out).toMatch(
      /upload \{\n\s+if \(project\.hasProperty\('TRAVELAPP_UPLOAD_STORE_FILE'\)\)/,
    );
    expect(out).toContain('storePassword TRAVELAPP_UPLOAD_STORE_PASSWORD');
    expect(out).toContain(
      "signingConfig project.hasProperty('TRAVELAPP_UPLOAD_STORE_FILE') ? signingConfigs.upload : signingConfigs.debug",
    );
  });

  it('leaves the debug build type on the debug key', () => {
    const out = addUploadSigning(GRADLE);
    expect(out).toMatch(/debug \{\n\s+signingConfig signingConfigs\.debug\n/);
    expect(out.match(/signingConfigs\.upload/g)).toHaveLength(1);
  });

  it('holds no secret: only property names', () => {
    expect(addUploadSigning(GRADLE)).not.toMatch(/TRAVELAPP_UPLOAD_\w+ ['"]/);
  });

  it('runs once', () => {
    const once = addUploadSigning(GRADLE);
    expect(addUploadSigning(once)).toBe(once);
  });

  it('fails loudly when the file changes shape', () => {
    expect(() => addUploadSigning('android {}')).toThrow(/signingConfigs/);
  });
});
