const { addStagingDir } = require('./withShortNativeBuildDir');

const GRADLE = `apply plugin: "com.android.application"

android {
    ndkVersion rootProject.ext.ndkVersion
}
`;

describe('withShortNativeBuildDir', () => {
  it('sets a short native build folder inside the android block', () => {
    const out = addStagingDir(GRADLE, 'C:\\x');
    expect(out).toContain('externalNativeBuild { cmake { buildStagingDirectory = file("C:/x") } }');
    expect(out.indexOf('buildStagingDirectory')).toBeGreaterThan(out.indexOf('android {'));
  });

  it('runs once', () => {
    const once = addStagingDir(GRADLE, 'C:/x');
    expect(addStagingDir(once, 'C:/x')).toBe(once);
  });

  it('fails loudly when the file changes shape', () => {
    expect(() => addStagingDir('plugins {}', 'C:/x')).toThrow(/android/);
  });
});
