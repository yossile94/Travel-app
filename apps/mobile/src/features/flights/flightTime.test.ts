import { dayMonth, dayOffset, sideTimes, spellCode, zonedWall, zonedWallToUtc } from './flightTime';

describe('zonedWallToUtc (sprint 5 AC-4, design 20.3)', () => {
  it('TLV in winter and summer', () => {
    expect(zonedWallToUtc('2026-12-20', '23:40', 'Asia/Jerusalem')).toEqual({
      kind: 'ok',
      utc: new Date('2026-12-20T21:40:00Z'),
    });
    expect(zonedWallToUtc('2026-07-01', '10:00', 'Asia/Jerusalem').utc).toEqual(
      new Date('2026-07-01T07:00:00Z'),
    );
  });

  it('a time skipped by the spring change moves forward (TLV, 27.3.2026)', () => {
    const r = zonedWallToUtc('2026-03-27', '02:30', 'Asia/Jerusalem');
    expect(r.kind).toBe('gap');
    expect(r.kind === 'gap' && r.savedWall).toBe('03:30');
  });

  it('a time shown twice in the autumn keeps the first (JFK, 1.11.2026)', () => {
    const r = zonedWallToUtc('2026-11-01', '01:30', 'America/New_York');
    expect(r).toEqual({ kind: 'overlap', utc: new Date('2026-11-01T05:30:00Z') });
  });

  it('half-hour zones and the date line', () => {
    expect(zonedWallToUtc('2026-12-20', '09:00', 'Asia/Kolkata').utc).toEqual(
      new Date('2026-12-20T03:30:00Z'),
    );
    expect(zonedWallToUtc('2026-12-20', '09:00', 'Pacific/Honolulu').utc).toEqual(
      new Date('2026-12-20T19:00:00Z'),
    );
  });
});

describe('sideTimes and dayOffset (design 9.3)', () => {
  it('TLV has no Israel time; JFK has it, with the Israel date when it differs', () => {
    const tlv = sideTimes('Asia/Jerusalem', 'IL', '2026-12-20T21:40:00Z', null);
    expect(tlv).toMatchObject({ local: '23:40', israel: null, changed: false });
    const jfk = sideTimes('America/New_York', 'US', '2026-12-21T04:30:00Z', null);
    expect(jfk).toMatchObject({
      local: '23:30',
      localDate: '2026-12-20',
      israel: '06:30',
      israelDate: '2026-12-21',
    });
  });

  it('15 minutes or more is a change and keeps the scheduled time; less is just shown', () => {
    const late = sideTimes('Asia/Jerusalem', 'IL', '2026-12-20T21:40:00Z', '2026-12-20T23:10:00Z');
    expect(late).toMatchObject({ local: '01:10', changed: true, scheduled: '23:40' });
    const near = sideTimes('Asia/Jerusalem', 'IL', '2026-12-20T21:40:00Z', '2026-12-20T21:50:00Z');
    expect(near).toMatchObject({ local: '23:50', changed: false, scheduled: null });
  });

  it('no time zone or no time: nothing to show', () => {
    expect(sideTimes(null, null, '2026-12-20T21:40:00Z', null).local).toBeNull();
  });

  it('day offsets across the date line: HNL→NRT +1, NRT→HNL the same day, and −1', () => {
    const dep = zonedWall('Pacific/Honolulu', new Date('2026-12-20T23:00:00Z'));
    const arr = zonedWall('Asia/Tokyo', new Date('2026-12-21T07:00:00Z'));
    expect(dayOffset(dep.date, arr.date)).toBe(1);
    const back = zonedWall('Asia/Tokyo', new Date('2026-12-21T12:00:00Z'));
    const land = zonedWall('Pacific/Honolulu', new Date('2026-12-21T19:00:00Z'));
    expect(dayOffset(back.date, land.date)).toBe(0);
    expect(dayOffset('2026-12-21', '2026-12-20')).toBe(-1);
  });
});

describe('small formats', () => {
  it('spells codes for screen readers', () => {
    expect(spellCode('LY81')).toBe('L Y 81');
    expect(spellCode('TLV')).toBe('T L V');
    expect(spellCode('6H12')).toBe('6 H 12');
    expect(spellCode('34A')).toBe('34 A');
  });

  it('day and month without leading zeros', () => {
    expect(dayMonth('2026-01-05')).toBe('5.1');
  });
});
