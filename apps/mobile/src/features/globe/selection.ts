/**
 * Which country is selected on the home globe, and whether the camera is
 * still flying to it (sprint 0 AC-4).
 *
 * Kept as a pure reducer so every edge case — switching mid-flight, tapping
 * the ocean, the Android back button — is covered by unit tests rather than
 * by tapping on a device.
 */

export interface SelectedCountry {
  /** Natural Earth adm0 code, unique per area (e.g. "THA"). */
  adm0: string;
}

export interface SelectionState {
  selected: SelectedCountry | null;
  /** True from a tap until the camera reaches the country. */
  flying: boolean;
}

export type SelectionEvent =
  | { type: 'countryTapped'; country: SelectedCountry }
  | { type: 'oceanTapped' }
  | { type: 'backPressed' }
  | { type: 'flightEnded' };

export const initialSelection: SelectionState = { selected: null, flying: false };

export function selectionReducer(state: SelectionState, event: SelectionEvent): SelectionState {
  switch (event.type) {
    case 'countryTapped':
      // Tapping the country that is already selected and settled does nothing;
      // anything else (including a different country mid-flight) starts a new flight.
      if (state.selected?.adm0 === event.country.adm0 && !state.flying) return state;
      return { selected: event.country, flying: true };
    case 'oceanTapped':
    case 'backPressed':
      return state.selected ? initialSelection : state;
    case 'flightEnded':
      return state.flying ? { ...state, flying: false } : state;
  }
}

/**
 * Whether the Android back button should be consumed by the globe (to close
 * the card) instead of leaving the screen.
 */
export function handlesBack(state: SelectionState): boolean {
  return state.selected !== null;
}
