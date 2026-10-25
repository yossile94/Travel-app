/**
 * The trip form's rules (sprint 2 design 3.2, 3.3), apart from the screen so
 * every case is unit-tested: the default name, what moving the departure
 * does to the return date, and validation in code points after trim.
 */
import type { TFunction } from 'i18next';

import { limits } from '@/theme/tokens';

import { codePointLength, defaultTripName } from './tripDates';

export interface TripFormValues {
  startDate: string | null;
  endDate: string | null;
  title: string;
  notes: string;
  /** The name follows the departure date until the user types in it (3.2). */
  nameAuto: boolean;
}

export type TripFormField = 'startDate' | 'endDate' | 'title' | 'notes';

/** Translation keys of each field's error; fields in screen order (3.3, focus goes to the first). */
export type TripFormErrors = Partial<Record<TripFormField, string>>;

export const FIELD_ORDER: readonly TripFormField[] = ['startDate', 'endDate', 'title', 'notes'];

export function emptyForm(): TripFormValues {
  return { startDate: null, endDate: null, title: '', notes: '', nameAuto: true };
}

/**
 * An existing trip: the name counts as automatic only while it equals the
 * name derived from its departure in the device's current language (19.4).
 */
export function formFromTrip(
  trip: { title: string; startDate: string; endDate: string; notes: string | null },
  country: string,
  t: TFunction,
): TripFormValues {
  return {
    startDate: trip.startDate,
    endDate: trip.endDate,
    title: trip.title,
    notes: trip.notes ?? '',
    nameAuto: trip.title === defaultTripName(country, trip.startDate, t),
  };
}

/**
 * A new departure date. A return date before it is cleared (`returnCleared`,
 * shown as help, not an error), and an automatic name follows the date.
 */
export function withStartDate(
  values: TripFormValues,
  startDate: string,
  country: string,
  t: TFunction,
): { values: TripFormValues; returnCleared: boolean } {
  const returnCleared = values.endDate !== null && values.endDate < startDate;
  return {
    values: {
      ...values,
      startDate,
      endDate: returnCleared ? null : values.endDate,
      title: values.nameAuto ? defaultTripName(country, startDate, t) : values.title,
    },
    returnCleared,
  };
}

/** The user typed in the name: from now on it is theirs (3.2). */
export function withTitle(values: TripFormValues, title: string): TripFormValues {
  return { ...values, title, nameAuto: false };
}

/** The name lost focus: an emptied name goes back to the automatic one (3.2). */
export function onTitleBlur(values: TripFormValues, country: string, t: TFunction): TripFormValues {
  if (values.title.trim() !== '' || !values.startDate) return values;
  return { ...values, title: defaultTripName(country, values.startDate, t), nameAuto: true };
}

export function validateTripForm(values: TripFormValues): TripFormErrors {
  const errors: TripFormErrors = {};
  if (!values.startDate) errors.startDate = 'tripForm.errors.departureRequired';
  if (!values.endDate) errors.endDate = 'tripForm.errors.returnRequired';
  else if (values.startDate && values.endDate < values.startDate) {
    errors.endDate = 'tripForm.errors.returnBeforeDeparture';
  }
  const title = codePointLength(values.title.trim());
  if (title === 0) errors.title = 'tripForm.errors.nameRequired';
  else if (title > limits.tripNameMax) errors.title = 'tripForm.errors.nameTooLong';
  if (codePointLength(values.notes.trim()) > limits.tripNotesMax) {
    errors.notes = 'tripForm.errors.notesTooLong';
  }
  return errors;
}

export function firstErrorField(errors: TripFormErrors): TripFormField | null {
  return FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** Whether leaving needs the "leave without saving?" dialog (3.5). */
export function isFormChanged(values: TripFormValues, initial: TripFormValues): boolean {
  return (
    values.startDate !== initial.startDate ||
    values.endDate !== initial.endDate ||
    values.title !== initial.title ||
    values.notes !== initial.notes
  );
}

/** What is sent: trimmed, and empty notes as null. */
export function tripFields(values: TripFormValues) {
  const notes = values.notes.trim();
  return {
    title: values.title.trim(),
    startDate: values.startDate!,
    endDate: values.endDate!,
    notes: notes === '' ? null : notes,
  };
}
