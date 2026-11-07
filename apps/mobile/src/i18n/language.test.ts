// jest.setup.ts pins the app to Hebrew; this checks the real choice.
const { appLanguage } = jest.requireActual<typeof import('./language')>('./language');

it('is Hebrew exactly when the layout is RTL (AC-6)', () => {
  expect(appLanguage(true)).toBe('he');
  expect(appLanguage(false)).toBe('en');
});
