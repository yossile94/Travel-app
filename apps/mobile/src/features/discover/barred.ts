/**
 * Countries Israelis are barred from (sprint 9 AC-9, Raz 5): never coloured,
 * even on a first launch offline before any advisory copy exists. Taken from
 * the NSC texts in the data.gov.il travel-warnings dataset on 2026-10-28,
 * each of which says entry is forbidden ("חל איסור" / "אסור להגיע"). The
 * device copy, once there, decides; this list only fills the gap.
 */
export const BARRED: ReadonlySet<string> = new Set(['IRN', 'IRQ', 'LBN', 'SAU', 'SYR', 'YEM']);
