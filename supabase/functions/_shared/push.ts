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
  dep_tz: string;
  arr_tz: string | null;
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

export function leadEvent(events: ChangeEvent[]): ChangeEvent {
  return [...events].sort((a, b) => ORDER[a.field]! - ORDER[b.field]! || a.id - b.id)[0]!;
}

/** "01:10" at a time zone; "+1" when the date moved from the old time's. */
export function clockAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

const TEXT = {
  he: {
    title: (n: string) => `שינוי בטיסה ${n}`,
    depLater: (n: string, t: string) => `${n} נדחתה. המראה חדשה ${t} (שעון מקומי)`,
    depEarlier: (n: string, t: string) => `${n} הוקדמה. המראה חדשה ${t} (שעון מקומי)`,
    arrLater: (n: string, t: string) => `${n}: הנחיתה נדחתה ל-${t} (שעון מקומי)`,
    arrEarlier: (n: string, t: string) => `${n}: הנחיתה הוקדמה ל-${t} (שעון מקומי)`,
    depGate: (n: string, g: string) => `${n}: שער ההמראה הוחלף ל-${g}`,
    arrGate: (n: string, g: string) => `${n}: שער הנחיתה הוחלף ל-${g}`,
    cancelled: (n: string) => `${n} בוטלה`,
    diverted: (n: string) => `${n} הוסטה`,
  },
  en: {
    title: (n: string) => `Flight ${n} changed`,
    depLater: (n: string, t: string) => `${n} is delayed. New departure ${t} local time`,
    depEarlier: (n: string, t: string) => `${n} leaves earlier. New departure ${t} local time`,
    arrLater: (n: string, t: string) => `${n} now lands at ${t} local time`,
    arrEarlier: (n: string, t: string) => `${n} now lands earlier, at ${t} local time`,
    depGate: (n: string, g: string) => `${n}: departure gate changed to ${g}`,
    arrGate: (n: string, g: string) => `${n}: arrival gate changed to ${g}`,
    cancelled: (n: string) => `${n} is cancelled`,
    diverted: (n: string) => `${n} is diverted`,
  },
};

export function messageBody(e: ChangeEvent, t: Target): string {
  const x = TEXT[t.locale];
  const n = t.flight_number;
  if (e.field === 'status') return e.new_value === 'Canceled' ? x.cancelled(n) : x.diverted(n);
  if (e.field === 'dep_gate') return x.depGate(n, e.new_value ?? '');
  if (e.field === 'arr_gate') return x.arrGate(n, e.new_value ?? '');
  const tz = e.field === 'dep_time' ? t.dep_tz : (t.arr_tz ?? t.dep_tz);
  const time = e.new_value ? clockAt(e.new_value, tz) : '';
  const later = !e.old_value || !e.new_value || Date.parse(e.new_value) > Date.parse(e.old_value);
  if (e.field === 'dep_time') return later ? x.depLater(n, time) : x.depEarlier(n, time);
  return later ? x.arrLater(n, time) : x.arrEarlier(n, time);
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
    out.push({
      tokenId: t.token_id,
      message: {
        to: t.token,
        title: TEXT[t.locale].title(t.flight_number),
        body: messageBody(lead, t),
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
