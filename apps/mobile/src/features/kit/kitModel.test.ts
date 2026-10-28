import {
  byCheckIn,
  cleanText,
  endsEarly,
  hotelDefaults,
  hotelErrors,
  hotelPayload,
  hotelsOutside,
  insuranceErrors,
  isNowHotel,
  nights,
  reminderDay,
  type Hotel,
  type HotelForm,
} from './kitModel';

const trip = { startDate: '2026-12-20', endDate: '2027-01-03' };
const hotel = (id: string, checkIn: string, checkOut: string, name = id): Hotel => ({
  id,
  tripId: 't',
  name,
  addressEn: 'x',
  addressLocal: null,
  phone: null,
  checkIn,
  checkOut,
  bookingRef: null,
});
const form = (o: Partial<HotelForm> = {}): HotelForm => ({
  name: 'Amari Watergate',
  addressEn: '847 Phetchaburi Road, Bangkok',
  addressLocal: '',
  phone: '',
  checkIn: '2026-12-20',
  checkOut: '2026-12-24',
  bookingRef: '',
  ...o,
});

describe('hotel rules', () => {
  it('orders by check-in, then by name (AC-2)', () => {
    const sorted = byCheckIn([
      hotel('b', '2026-12-24', '2027-01-03'),
      hotel('z', '2026-12-20', '2026-12-24'),
      hotel('a', '2026-12-20', '2026-12-22'),
    ]);
    expect(sorted.map((h) => h.id)).toEqual(['a', 'z', 'b']);
  });

  it('counts nights, also across the new year', () => {
    expect(nights('2026-12-20', '2026-12-24')).toBe(4);
    expect(nights('2026-12-24', '2027-01-03')).toBe(10);
  });

  it('marks the hotel of today; check-out morning moves to the next', () => {
    const a = hotel('a', '2026-12-20', '2026-12-24');
    expect(isNowHotel(a, '2026-12-20')).toBe(true);
    expect(isNowHotel(a, '2026-12-23')).toBe(true);
    expect(isNowHotel(a, '2026-12-24')).toBe(false);
  });

  it('starts a new hotel after the last one; empty when the trip is full (design 4.2)', () => {
    expect(hotelDefaults([], trip)).toEqual({ checkIn: '2026-12-20', checkOut: '2027-01-03' });
    expect(hotelDefaults([hotel('a', '2026-12-20', '2026-12-24')], trip)).toEqual({
      checkIn: '2026-12-24',
      checkOut: '2027-01-03',
    });
    expect(hotelDefaults([hotel('a', '2026-12-20', '2027-01-03')], trip)).toEqual({
      checkIn: null,
      checkOut: null,
    });
  });

  it('accepts a valid hotel', () => {
    expect(hotelErrors(form({ phone: '+66 2 653-9000', bookingRef: 'BK-1' }), trip)).toEqual({});
  });

  it('requires a name, an English address and both dates', () => {
    expect(
      hotelErrors(form({ name: ' ', addressEn: '', checkIn: null, checkOut: null }), trip),
    ).toEqual({
      name: 'required',
      addressEn: 'required',
      checkIn: 'required',
      checkOut: 'required',
    });
  });

  it('limits lengths in code points (AC-1)', () => {
    const e = hotelErrors(
      form({ name: 'א'.repeat(81), addressLocal: 'ก'.repeat(201), bookingRef: 'A'.repeat(41) }),
      trip,
    );
    expect(e).toEqual({ name: 'tooLong', addressLocal: 'tooLong', bookingRef: 'tooLong' });
    expect(hotelErrors(form({ name: '😀'.repeat(80) }), trip)).toEqual({});
  });

  it('keeps dates inside the trip, check-out after check-in, same day refused (AC-1)', () => {
    expect(hotelErrors(form({ checkIn: '2026-12-19' }), trip).checkIn).toBe('outsideTrip');
    expect(hotelErrors(form({ checkOut: '2027-01-04' }), trip).checkOut).toBe('outsideTrip');
    expect(hotelErrors(form({ checkOut: '2026-12-20' }), trip).checkOut).toBe('order');
    expect(
      hotelErrors(form({ checkIn: '2026-12-25', checkOut: '2026-12-24' }), trip).checkOut,
    ).toBe('order');
    expect(hotelErrors(form({ checkOut: '2027-01-03' }), trip)).toEqual({});
  });

  it('refuses a phone without a country code', () => {
    expect(hotelErrors(form({ phone: '026535000' }), trip).phone).toBe('phone');
  });

  it('saves E.164, trimmed text and null for empty fields', () => {
    expect(hotelPayload(form({ phone: '0066 2 6539000', addressLocal: '  ' }))).toMatchObject({
      phone: '+6626539000',
      addressLocal: null,
      bookingRef: null,
    });
  });

  it('removes bidi controls from pasted text', () => {
    expect(cleanText('\u200f847 ถนน\u202a เพชรบุรี\u202c ')).toBe('847 ถนน เพชรบุรี');
  });

  it('lists the hotels new trip dates would leave outside (design 7)', () => {
    const hs = [hotel('a', '2026-12-20', '2026-12-24'), hotel('b', '2026-12-24', '2027-01-03')];
    expect(hotelsOutside(hs, '2026-12-21', '2027-01-03').map((h) => h.id)).toEqual(['a']);
    expect(hotelsOutside(hs, '2026-12-20', '2026-12-28').map((h) => h.id)).toEqual(['b']);
    expect(hotelsOutside(hs, '2026-12-19', '2027-01-05')).toEqual([]);
  });
});

describe('insurance rules', () => {
  it('requires the company; limits the rest (AC-7)', () => {
    expect(
      insuranceErrors({
        provider: '',
        policyNumber: 'P'.repeat(41),
        validUntil: null,
        emergencyPhone: '123',
        notes: 'n'.repeat(301),
      }),
    ).toEqual({
      provider: 'required',
      policyNumber: 'tooLong',
      emergencyPhone: 'phone',
      notes: 'tooLong',
    });
    expect(
      insuranceErrors({
        provider: 'הראל',
        policyNumber: '',
        validUntil: null,
        emergencyPhone: '+972 3 929 4000',
        notes: '',
      }),
    ).toEqual({});
  });

  it('warns when the policy ends before the return (AC-7)', () => {
    expect(endsEarly('2027-01-01', '2027-01-03')).toBe(true);
    expect(endsEarly('2027-01-03', '2027-01-03')).toBe(false);
    expect(endsEarly(null, '2027-01-03')).toBe(false);
  });

  it('reminds a week before departure (AC-10)', () => {
    expect(reminderDay('2027-01-05')).toBe('2026-12-29');
  });
});
