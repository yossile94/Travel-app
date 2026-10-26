import i18n from '@/i18n';

import {
  emptyForm,
  firstErrorField,
  formFromTrip,
  isFormChanged,
  onTitleBlur,
  thousands,
  tripFields,
  validateTripForm,
  withStartDate,
  withTitle,
} from './tripFormRules';

const t = i18n.t.bind(i18n);

describe('trip form (sprint 2 design 3.2, 3.3)', () => {
  it('names the trip from the departure until the user types (AC-2)', () => {
    let { values } = withStartDate(emptyForm(), '2027-08-12', 'תאילנד', t);
    expect(values.title).toBe('תאילנד אוגוסט 2027');
    values = withStartDate(values, '2027-09-01', 'תאילנד', t).values;
    expect(values.title).toBe('תאילנד ספטמבר 2027');
    values = withTitle(values, 'ירח דבש');
    values = withStartDate(values, '2027-10-01', 'תאילנד', t).values;
    expect(values.title).toBe('ירח דבש');
  });

  it('an emptied name goes back to the automatic one on blur', () => {
    let { values } = withStartDate(emptyForm(), '2027-08-12', 'תאילנד', t);
    values = withTitle(values, '   ');
    values = onTitleBlur(values, 'תאילנד', t);
    expect(values).toMatchObject({ title: 'תאילנד אוגוסט 2027', nameAuto: true });
  });

  it('editing: automatic only if the name equals the derived one in this language (19.4)', () => {
    const trip = {
      title: 'תאילנד אוגוסט 2027',
      startDate: '2027-08-12',
      endDate: '2027-08-20',
      notes: null,
    };
    expect(formFromTrip(trip, 'תאילנד', t).nameAuto).toBe(true);
    const en = i18n.cloneInstance({ lng: 'en' });
    expect(formFromTrip(trip, 'Thailand', en.t.bind(en)).nameAuto).toBe(false);
  });

  it('moving the departure past the return clears the return (3.3)', () => {
    const start = { ...emptyForm(), startDate: '2027-08-01', endDate: '2027-08-05' };
    const moved = withStartDate(start, '2027-08-10', 'תאילנד', t);
    expect(moved.returnCleared).toBe(true);
    expect(moved.values.endDate).toBeNull();
    expect(withStartDate(start, '2027-08-05', 'תאילנד', t).returnCleared).toBe(false);
  });

  it('validates every field, and the first error is the first on screen', () => {
    const errors = validateTripForm(emptyForm());
    expect(errors).toEqual({
      startDate: 'tripForm.errors.departureRequired',
      endDate: 'tripForm.errors.returnRequired',
      title: 'tripForm.errors.nameRequired',
    });
    expect(firstErrorField(errors)).toBe('startDate');
    expect(
      validateTripForm({
        ...emptyForm(),
        startDate: '2027-08-05',
        endDate: '2027-08-01',
        title: 'x',
      }),
    ).toEqual({ endDate: 'tripForm.errors.returnBeforeDeparture' });
    // Same day is allowed.
    expect(
      validateTripForm({
        ...emptyForm(),
        startDate: '2027-08-05',
        endDate: '2027-08-05',
        title: 'x',
      }),
    ).toEqual({});
  });

  it('counts the name and notes in code points after trim, like the database', () => {
    const ok = { ...emptyForm(), startDate: '2027-08-05', endDate: '2027-08-05' };
    // 80 emoji are 160 UTF-16 units but 80 characters: allowed.
    expect(validateTripForm({ ...ok, title: `  ${'🏝'.repeat(80)}  ` })).toEqual({});
    expect(validateTripForm({ ...ok, title: 'a'.repeat(81) }).title).toBe(
      'tripForm.errors.nameTooLong',
    );
    expect(validateTripForm({ ...ok, title: 'x', notes: 'a'.repeat(2001) }).notes).toBe(
      'tripForm.errors.notesTooLong',
    );
  });

  it('writes counters with a thousands separator, without Intl', () => {
    expect(thousands(840)).toBe('840');
    expect(thousands(1840)).toBe('1,840');
    expect(thousands(2000)).toBe('2,000');
    expect(thousands(1234567)).toBe('1,234,567');
  });

  it('knows when leaving needs a confirmation, and sends trimmed values', () => {
    const initial = emptyForm();
    expect(isFormChanged(initial, initial)).toBe(false);
    expect(isFormChanged({ ...initial, notes: 'x' }, initial)).toBe(true);
    expect(
      tripFields({
        ...initial,
        startDate: '2027-08-05',
        endDate: '2027-08-06',
        title: ' a ',
        notes: '  ',
      }),
    ).toEqual({
      title: 'a',
      startDate: '2027-08-05',
      endDate: '2027-08-06',
      notes: null,
      travelers: [],
      cities: [],
    });
  });
});
