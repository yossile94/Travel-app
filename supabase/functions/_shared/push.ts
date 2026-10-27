/**
 * Flight alerts (sprint 6 F-018, ADR-011): one notification per flight and
 * user for each check (Raz 2), in the user's language, with the new time in
 * the airport's clock. Nothing personal: the flight number and the change;
 * the data carries only the user's own flight row id (Raz 9).
 */

export type ChangeEvent = {
  id: number;
  watch_id: number;
  field: 'dep_time' | 'arr_time' | 'dep_gate' | 'arr_gate' | 'status';
  old_value: string | null;
  new_value: string | null;
};

export type Target = {
  watch_id: number;
  user_id: string;
  flight_id: string;
  flight_number: string;
  /** The number as the user typed it (design 3.2). */
  flight_number_input: string;
  dep_tz: string;
  arr_tz: string | null;
  dep_iata: string;
  arr_iata: string | null;
  dep_date_local: string;
  token_id: number;
  token: string;
  locale: 'he' | 'en';
};

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: { v: 1; type: 'flight_change'; flightId: string };
  channelId: 'flight-changes';
  priority: 'high';
  ttl: number;
  sound: 'default';
};

/** The change the text is about: cancelled or diverted, then departure, gate, arrival (Raz 2). */
const ORDER: Record<string, number> = {
  status: 0,
  dep_time: 1,
  dep_gate: 2,
  arr_time: 3,
  arr_gate: 4,
};

/** A later arrival comes with almost every delay: it is the same change (Raz, design 3.1). */
const KIND: Record<string, string> = {
  status: 'status',
  dep_time: 'time',
  arr_time: 'time',
  dep_gate: 'dep_gate',
  arr_gate: 'arr_gate',
};

/** Whether the alert says "more changes": another kind of change than the lead's. */
export function hasMoreChanges(events: ChangeEvent[], lead: ChangeEvent): boolean {
  return events.some((e) => KIND[e.field] !== KIND[lead.field]);
}

/**
 * The change the alert speaks of. Two checks' changes of one field (a send
 * that waited): the latest value, "instead of" the value users last had
 * (Raz review 2).
 */
export function leadEvent(events: ChangeEvent[]): ChangeEvent {
  const sorted = [...events].sort((a, b) => ORDER[a.field]! - ORDER[b.field]! || b.id - a.id);
  const lead = sorted[0]!;
  const same = events.filter((e) => e.field === lead.field);
  const first = same.reduce((a, b) => (b.id < a.id ? b : a));
  return { ...lead, old_value: first.old_value };
}

/** "01:10" at a time zone, 24-hour. */
export function clockAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** The local date "YYYY-MM-DD" at a time zone. */
function dateAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "21.12" in Hebrew, "21 Dec" in English (design 3.2). */
function shortDate(date: string, locale: 'he' | 'en'): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return locale === 'he' ? `${d}.${m}` : `${d} ${MONTHS[m - 1]}`;
}

/** Right-to-left mark: a Hebrew line that starts with "LY81" still reads right to left (design 3.1). */
const RLM = String.fromCharCode(0x200f);

type Text = {
  delayed: string;
  earlier: string;
  gateTitle: string;
  cancelledTitle: string;
  divertedTitle: string;
  arrLaterTitle: string;
  arrEarlierTitle: string;
  arrGateTitle: string;
  newDep: (time: string, apt: string) => string;
  newArr: (time: string, apt: string) => string;
  was: (old: string) => string;
  depGate: (gate: string, old: string | null) => string;
  arrGate: (gate: string, old: string | null) => string;
  cancelled: (from: string, to: string, date: string) => string;
  diverted: (to: string | null) => string;
  onDate: (time: string, date: string) => string;
  more: string;
};

/** The wording of design 3.2, Hebrew and English. */
const TEXT: Record<'he' | 'en', Text> = {
  he: {
    delayed: 'נדחתה',
    earlier: 'הוקדמה',
    gateTitle: ': השער הוחלף',
    cancelledTitle: 'בוטלה',
    divertedTitle: 'הוסטה',
    arrLaterTitle: ': הנחיתה נדחתה',
    arrEarlierTitle: ': הנחיתה הוקדמה',
    arrGateTitle: ': שער הנחיתה הוחלף',
    newDep: (time, apt) => `המראה חדשה: ${time}, שעון ${apt}.`,
    newArr: (time, apt) => `נחיתה צפויה: ${time}, שעון ${apt}.`,
    was: (old) => ` במקום ${old}.`,
    depGate: (gate, old) =>
      old ? `שער ההמראה החדש: ${gate}. במקום ${old}.` : `שער ההמראה: ${gate}.`,
    arrGate: (gate, old) =>
      old ? `שער הנחיתה החדש: ${gate}. במקום ${old}.` : `שער הנחיתה: ${gate}.`,
    cancelled: (from, to, date) =>
      `הטיסה מ-${from} ל-${to} ב-${date} בוטלה. כדאי לבדוק מול חברת התעופה.`,
    diverted: (to) => (to ? `הטיסה לא תנחת ב-${to} כמתוכנן.` : 'הטיסה לא תנחת ביעד כמתוכנן.'),
    onDate: (time, date) => `${time} ב-${date}`,
    more: ' יש עוד שינויים בטיסה.',
  },
  en: {
    delayed: 'delayed',
    earlier: 'moved earlier',
    gateTitle: ' gate change',
    cancelledTitle: 'cancelled',
    divertedTitle: 'diverted',
    arrLaterTitle: ' arrives later',
    arrEarlierTitle: ' arrives earlier',
    arrGateTitle: ' arrival gate change',
    newDep: (time, apt) => `New departure: ${time}, ${apt} time.`,
    newArr: (time, apt) => `New arrival: ${time}, ${apt} time.`,
    was: (old) => ` Was ${old}.`,
    depGate: (gate, old) =>
      old ? `New departure gate: ${gate}. Was ${old}.` : `Departure gate: ${gate}.`,
    arrGate: (gate, old) =>
      old ? `New arrival gate: ${gate}. Was ${old}.` : `Arrival gate: ${gate}.`,
    cancelled: (from, to, date) =>
      `Your flight from ${from} to ${to} on ${date} is cancelled. Check with the airline.`,
    diverted: (to) =>
      to ? `It won't land at ${to} as planned.` : "It won't land at its destination as planned.",
    onDate: (time, date) => `${time} on ${date}`,
    more: ' There are more changes.',
  },
};

/** The title and body of one alert (design 3.2), pure for tests. */
export function buildContent(
  e: ChangeEvent,
  t: Target,
  moreChanges: boolean,
): { title: string; body: string } {
  const x = TEXT[t.locale];
  const n = t.flight_number_input || t.flight_number;
  const to = t.arr_iata ?? '—';
  let title: string;
  let body: string;
  if (e.field === 'status') {
    const cancelled = e.new_value === 'Canceled';
    title = `${n} ${cancelled ? x.cancelledTitle : x.divertedTitle}`;
    body = cancelled
      ? x.cancelled(t.dep_iata, to, shortDate(t.dep_date_local, t.locale))
      : x.diverted(t.arr_iata);
    // After a cancellation nothing else matters (design 3.1).
    if (!cancelled && moreChanges) body += x.more;
  } else if (e.field === 'dep_gate' || e.field === 'arr_gate') {
    title = `${n}${e.field === 'dep_gate' ? x.gateTitle : x.arrGateTitle}`;
    body = (e.field === 'dep_gate' ? x.depGate : x.arrGate)(e.new_value ?? '', e.old_value);
    if (moreChanges) body += x.more;
  } else {
    const dep = e.field === 'dep_time';
    const tz = dep ? t.dep_tz : (t.arr_tz ?? t.dep_tz);
    const apt = dep ? t.dep_iata : to;
    const later = !e.old_value || !e.new_value || Date.parse(e.new_value) > Date.parse(e.old_value);
    title = dep
      ? `${n} ${later ? x.delayed : x.earlier}`
      : `${n}${later ? x.arrLaterTitle : x.arrEarlierTitle}`;
    let time = e.new_value ? clockAt(e.new_value, tz) : '—';
    // A time on another day than the old one says the day (design 3.1).
    if (e.new_value && e.old_value && dateAt(e.new_value, tz) !== dateAt(e.old_value, tz)) {
      time = x.onDate(time, shortDate(dateAt(e.new_value, tz), t.locale));
    }
    body = (dep ? x.newDep : x.newArr)(time, apt);
    if (e.old_value) body += x.was(clockAt(e.old_value, tz));
    if (moreChanges) body += x.more;
  }
  return t.locale === 'he' ? { title: RLM + title, body: RLM + body } : { title, body };
}

/** One message per (watch, user, device): the lead change of that watch's events. */
export function buildMessages(
  events: ChangeEvent[],
  targets: Target[],
): { message: PushMessage; tokenId: number }[] {
  const byWatch = new Map<number, ChangeEvent[]>();
  for (const e of events) byWatch.set(e.watch_id, [...(byWatch.get(e.watch_id) ?? []), e]);
  const out: { message: PushMessage; tokenId: number }[] = [];
  for (const t of targets) {
    const list = byWatch.get(t.watch_id);
    if (!list?.length) continue;
    const lead = leadEvent(list);
    const { title, body } = buildContent(lead, t, hasMoreChanges(list, lead));
    out.push({
      tokenId: t.token_id,
      message: {
        to: t.token,
        title,
        body,
        data: { v: 1, type: 'flight_change', flightId: t.flight_id },
        channelId: 'flight-changes',
        priority: 'high',
        // A delay alert hours late does harm (Raz 12).
        ttl: 60 * 60,
        sound: 'default',
      },
    });
  }
  return out;
}

export type Ticket =
  { status: 'ok'; id: string } | { status: 'error'; details?: { error?: string } };

export type PushSender = {
  /** Up to 100 per call; tickets in the same order. */
  send(
    messages: PushMessage[],
  ): Promise<{ ok: true; tickets: Ticket[] } | { ok: false; status: number }>;
  /** Receipts by ticket id. */
  receipts(
    ids: string[],
  ): Promise<Record<string, { status: 'ok' | 'error'; details?: { error?: string } }>>;
};

const EXPO = 'https://exp.host/--/api/v2/push';

export function expoSender(
  accessToken: string | undefined,
  fetchFn: typeof fetch = fetch,
): PushSender {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return {
    async send(messages) {
      try {
        const res = await fetchFn(`${EXPO}/send`, {
          method: 'POST',
          headers,
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return { ok: false, status: res.status };
        const body = (await res.json()) as { data?: Ticket[] };
        return { ok: true, tickets: body.data ?? [] };
      } catch {
        return { ok: false, status: 0 };
      }
    },
    async receipts(ids) {
      try {
        const res = await fetchFn(`${EXPO}/getReceipts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return {};
        return ((await res.json()) as { data?: Record<string, never> }).data ?? {};
      } catch {
        return {};
      }
    },
  };
}
