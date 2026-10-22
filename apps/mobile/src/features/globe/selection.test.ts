import {
  handlesBack,
  initialSelection,
  selectionReducer,
  type SelectionEvent,
  type SelectionState,
} from './selection';

const thailand = { code: 'TH' };
const japan = { code: 'JP' };

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
