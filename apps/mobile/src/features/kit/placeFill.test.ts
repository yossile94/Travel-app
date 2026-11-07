import type { Hotel, HotelForm } from './kitModel';
import {
  applyFill,
  editedFields,
  fromGoogle,
  googleFill,
  pointExpired,
  withLivePoint,
} from './placeFill';
import type { PickedPlace } from './placesApi';
import { placesFrom } from './placesApi';

const picked = (o: Partial<PickedPlace> = {}): PickedPlace => ({
  placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  nameLocal: 'โรงแรมสยาม',
  addressLocal: '3/2 ถนนขาว กรุงเทพฯ',
  nameEn: 'Siam Hotel',
  addressEn: '3/2 Khao Rd, Bangkok',
  phone: '+66 2 206 6999',
  lat: 13.78,
  lng: 100.5,
  fetchedAt: '2026-11-08T08:00:00.000Z',
  ...o,
});
const empty: HotelForm = {
  name: '',
  nameLocal: '',
  addressEn: '',
  addressLocal: '',
  phone: '',
  checkIn: '2026-12-20',
  checkOut: '2026-12-24',
  bookingRef: 'BK-1',
};

describe('googleFill (design 1.5, Raz 4 and 7)', () => {
  it('puts English on top, the local text beside it, and the phone in E.164', () => {
    expect(googleFill(picked())).toEqual({
      name: 'Siam Hotel',
      nameLocal: 'โรงแรมสยาม',
      addressEn: '3/2 Khao Rd, Bangkok',
      addressLocal: '3/2 ถนนขาว กรุงเทพฯ',
      phone: '+6622066999',
      point: [100.5, 13.78],
      placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      fetchedAt: '2026-11-08T08:00:00.000Z',
    });
  });

  it('leaves the local fields empty when they repeat the English ones', () => {
    const f = googleFill(
      picked({ nameLocal: 'Savoy', nameEn: 'Savoy', addressLocal: 'Strand', addressEn: 'Strand' }),
    );
    expect([f.nameLocal, f.addressLocal]).toEqual(['', '']);
  });

  it('cuts long values to the limits, and drops a phone that is not a number', () => {
    const f = googleFill(
      picked({ nameEn: 'x'.repeat(120), addressEn: 'y'.repeat(260), phone: 'call us' }),
    );
    expect([...f.name].length).toBe(80);
    expect([...f.addressEn].length).toBe(200);
    expect(f.phone).toBe('');
  });

  it('falls back to the local name when there is no English one', () => {
    expect(googleFill(picked({ nameEn: null })).name).toBe('โรงแรมสยาม');
  });
});

describe('applyFill (design 1.5)', () => {
  it('fills the five fields and the point, and never the dates or booking', () => {
    const { form, point } = applyFill(empty, null, googleFill(picked()), null);
    expect(form).toMatchObject({ name: 'Siam Hotel', phone: '+6622066999', bookingRef: 'BK-1' });
    expect(form.checkIn).toBe('2026-12-20');
    expect(point).toEqual([100.5, 13.78]);
  });

  it('clears what the last pick filled where Google has nothing now, and keeps what the user typed', () => {
    const first = googleFill(picked());
    const after = applyFill(empty, null, first, null);
    const typed = { ...after.form, nameLocal: 'שם שהקלדתי' };
    const second = googleFill(picked({ phone: null, nameLocal: null, lat: null, lng: null }));
    const { form, point } = applyFill(typed, after.point, second, first);
    expect(form.phone).toBe('');
    expect(form.nameLocal).toBe('שם שהקלדתי');
    expect(point).toBeNull();
  });
});

describe('what the user changed (Raz design approval 6)', () => {
  const fill = googleFill(picked());
  const { form, point } = applyFill(empty, null, fill, null);

  it('nothing when the form still holds what Google gave', () => {
    expect(editedFields(form, point, fill, null)).toEqual([]);
    expect(fromGoogle(form, fill, 'name')).toBe(true);
  });

  it('the fields that differ, and the point when it moved', () => {
    const edited = { ...form, phone: '+66 2 000 0000' };
    expect(editedFields(edited, [100.6, 13.9], fill, null)).toEqual(['phone', 'point']);
    expect(fromGoogle(edited, fill, 'phone')).toBe(false);
  });

  it('without a pick in this screen: the saved list, plus a moved point', () => {
    const saved = {
      placeId: 'p',
      placeEdited: ['phone'],
      point: [100.5, 13.78],
    } as unknown as Hotel;
    expect(editedFields(form, [100.5, 13.78], null, saved)).toEqual(['phone']);
    expect(editedFields(form, [1, 2], null, saved)).toEqual(['phone', 'point']);
  });
});

describe("Google's 30 days on the point (ADR-021)", () => {
  const now = new Date('2026-12-20T00:00:00Z');
  const h = (o: Partial<Hotel>): Hotel =>
    ({
      id: 'h',
      tripId: 't',
      point: [100.5, 13.78],
      placeId: 'p',
      placeFetchedAt: '2026-11-08T00:00:00Z',
      placeEdited: [],
      ...o,
    }) as Hotel;

  it('a Google point past 30 days has expired, and the device drops it', () => {
    expect(pointExpired(h({}), now)).toBe(true);
    expect(withLivePoint(h({}), now).point).toBeNull();
  });

  it("a fresh one, one the user moved, or one picked on the map hasn't", () => {
    expect(pointExpired(h({ placeFetchedAt: '2026-12-01T00:00:00Z' }), now)).toBe(false);
    expect(pointExpired(h({ placeEdited: ['point'] }), now)).toBe(false);
    expect(pointExpired(h({ placeId: null, placeFetchedAt: null }), now)).toBe(false);
  });
});

describe('placesFrom: the body decides (Raz design approval 1)', () => {
  it('reads each answer', () => {
    expect(placesFrom(200, { suggestions: [] })).toEqual({ kind: 'ok', body: { suggestions: [] } });
    expect(placesFrom(200, { gone: true })).toEqual({ kind: 'gone' });
    expect(placesFrom(503, { error: 'unavailable' })).toEqual({ kind: 'unavailable' });
    expect(placesFrom(429, { error: 'quota' })).toEqual({ kind: 'quota' });
    expect(placesFrom(503, { error: 'provider' })).toEqual({ kind: 'failed' });
    // A gateway 503 without our body is a passing failure, not "no key".
    expect(placesFrom(503, null)).toEqual({ kind: 'failed' });
  });
});
