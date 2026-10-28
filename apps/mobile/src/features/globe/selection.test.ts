import {
  handlesBack,
  initialSelection,
  selectionReducer,
  type SelectionEvent,
  type SelectionState,
} from './selection';

const thailand = { adm0: 'THA' };
const japan = { adm0: 'JPN' };

function run(...events: SelectionEvent[]): SelectionState {
  return events.reduce(selectionReducer, initialSelection);
}

describe('selectionReducer', () => {
  it('selects a tapped country and starts flying to it', () => {
    expect(run({ type: 'countryTapped', country: thailand })).toEqual({
      selected: thailand,
      flying: true,
    });
  });

  it('stops flying when the camera arrives', () => {
    expect(run({ type: 'countryTapped', country: thailand }, { type: 'flightEnded' })).toEqual({
      selected: thailand,
      flying: false,
    });
  });

  it('switches to another country in the middle of a flight', () => {
    expect(
      run({ type: 'countryTapped', country: thailand }, { type: 'countryTapped', country: japan }),
    ).toEqual({ selected: japan, flying: true });
  });

  it('ignores a tap on the country that is already selected', () => {
    const settled = run({ type: 'countryTapped', country: thailand }, { type: 'flightEnded' });
    expect(selectionReducer(settled, { type: 'countryTapped', country: thailand })).toBe(settled);
  });

  it('closes the card when the ocean is tapped, even mid-flight', () => {
    expect(run({ type: 'countryTapped', country: thailand }, { type: 'oceanTapped' })).toEqual(
      initialSelection,
    );
  });

  it('closes the card on the Android back button', () => {
    expect(
      run(
        { type: 'countryTapped', country: thailand },
        { type: 'flightEnded' },
        { type: 'backPressed' },
      ),
    ).toEqual(initialSelection);
  });

  it('keeps the same state object when nothing changes, so React skips a render', () => {
    expect(selectionReducer(initialSelection, { type: 'oceanTapped' })).toBe(initialSelection);
    expect(selectionReducer(initialSelection, { type: 'flightEnded' })).toBe(initialSelection);
  });
});

describe('handlesBack', () => {
  it('consumes back only while a country is selected', () => {
    expect(handlesBack(initialSelection)).toBe(false);
    expect(handlesBack(run({ type: 'countryTapped', country: thailand }))).toBe(true);
  });
});

describe('a city from search (sprint 9 AC-12, AC-13)', () => {
  const miami = {
    id: 4164138,
    nameHe: 'מיאמי',
    nameEn: 'Miami',
    point: [-80.19, 25.77] as [number, number],
  };
  const usa = { adm0: 'USA' };

  it('another city in the country already open flies again', () => {
    const settled = run({ type: 'countryTapped', country: usa }, { type: 'flightEnded' });
    const next = selectionReducer(settled, {
      type: 'countryTapped',
      country: { ...usa, city: miami },
    });
    expect(next).toEqual({ selected: { ...usa, city: miami }, flying: true });
  });

  it('the same city again, settled, does nothing', () => {
    const settled = run(
      { type: 'countryTapped', country: { ...usa, city: miami } },
      { type: 'flightEnded' },
    );
    expect(
      selectionReducer(settled, { type: 'countryTapped', country: { ...usa, city: miami } }),
    ).toBe(settled);
  });

  it('a new search hides the pin and keeps the country and its city (Raz B-1)', () => {
    const settled = run(
      { type: 'countryTapped', country: { ...usa, city: miami } },
      { type: 'flightEnded' },
      { type: 'cityCleared' },
    );
    expect(settled).toEqual({ selected: { ...usa, city: miami }, flying: false, pinHidden: true });
    // Choosing the same city again shows the pin again (a new flight).
    expect(
      selectionReducer(settled, { type: 'countryTapped', country: { ...usa, city: miami } }),
    ).toEqual({ selected: { ...usa, city: miami }, flying: true });
  });
});
