'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { useOnline } from '@/components/Offline';
import { Toast } from '@/components/Toast';
import { citiesOf } from '@/lib/cities';
import {
  BODY_MAX,
  cityFor,
  CURATED_CATEGORIES,
  CURATED_STATUSES,
  curatedErrors,
  parseCoords,
  type CuratedError,
  type CuratedField,
  type CuratedForm,
} from '@/lib/curated';
import { saveCuratedAction } from '@/lib/save';

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
const FIELDS: CuratedField[] = [
  'adm0',
  'category',
  'nameHe',
  'nameEn',
  'body',
  'coords',
  'source',
  'verified',
  'status',
];
const ISRAELI = ['kosher', 'chabad', 'memorial'];

/** Design 23.3, AC-19 – AC-21: every rule in every status (D15). */
export function PlaceForm({
  id,
  initial,
  countries,
  initialCities,
  words: w,
}: {
  id: string | null;
  initial: CuratedForm;
  countries: { adm0: string; name: string }[];
  initialCities: { name: string; point: [number, number] }[];
  words: Record<string, string>;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [cities, setCities] = useState(initialCities);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const online = useOnline();
  const errors = tried ? curatedErrors(form, today()) : {};
  const errorWords: Record<CuratedError, string> = {
    country: w['places.err.country']!,
    category: w['places.err.category']!,
    nameRequired: w['places.err.nameRequired']!,
    nameMax: w['places.err.nameMax']!,
    descMax: w['places.err.descMax']!,
    coords: w['places.err.coords']!,
    lat: w['places.err.lat']!,
    lng: w['places.err.lng']!,
    sourceRequired: w['mct.err.source']!,
    sourceHttps: w['err.https']!,
    verifiedRequired: w['mct.err.verified']!,
    verifiedFuture: w['err.future']!,
    status: w['places.err.category']!,
  };
  const msg = (f: CuratedField) => (errors[f] ? errorWords[errors[f]] : null);
  const set = (patch: Partial<CuratedForm>) => setForm((v) => ({ ...v, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const point = parseCoords(form.coords);
  const city = typeof point === 'object' ? cityFor([point.lng, point.lat], cities) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(curatedErrors(form, today())).length)
      return setTimeout(() => summary.current?.focus(), 0);
    setBusy(true);
    setServer(null);
    const result = await saveCuratedAction(form, id).catch(() => ({
      ok: false as const,
      error: 'failed' as const,
    }));
    setBusy(false);
    if (result.ok) {
      if (id === null && 'id' in result) return router.push(`/places/${result.id}`);
      return setToast(w.saved!);
    }
    setServer(
      'fields' in result
        ? w.serverRejected!
        : result.error === 'denied'
          ? w.denied!
          : result.error === 'rejected'
            ? w.serverRejected!
            : w.saveError!,
    );
    summary.current?.focus();
  };

  const count = Object.keys(errors).length;
  const described = (f: CuratedField) => ({
    id: `place-${f}`,
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': errors[f] ? `place-${f}-error` : undefined,
  });
  const error = (f: CuratedField) =>
    errors[f] ? (
      <span id={`place-${f}-error`} className="error">
        {msg(f)}
      </span>
    ) : null;

  return (
    <form onSubmit={submit} noValidate data-testid="admin-place-form">
      {count || server ? (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="alert"
          data-testid="admin-error-summary"
        >
          {server ??
            (count === 1
              ? w['errorSummary.one']
              : w['errorSummary.many']!.replace('{{n}}', String(count)))}
          {count ? (
            <ul>
              {FIELDS.filter((f) => errors[f]).map((f) => (
                <li key={f}>
                  <a href={`#place-${f}`}>{msg(f)}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="place-adm0">{w['places.country']}</label>
        <select
          {...described('adm0')}
          value={form.adm0}
          onChange={(e) => {
            const adm0 = e.target.value;
            set({ adm0 });
            void citiesOf(adm0).then(setCities, () => setCities([]));
          }}
          data-testid="admin-place-country"
        >
          <option value="" />
          {countries.map((c) => (
            <option key={c.adm0} value={c.adm0}>
              {c.name}
            </option>
          ))}
        </select>
        {error('adm0')}
      </div>
      <div className="field">
        <label htmlFor="place-category">{w['places.category']}</label>
        <select
          {...described('category')}
          value={form.category}
          onChange={(e) => set({ category: e.target.value })}
          data-testid="admin-place-category"
        >
          <option value="" />
          <optgroup label={w['places.groupIsraeli']}>
            {CURATED_CATEGORIES.filter((c) => ISRAELI.includes(c)).map((c) => (
              <option key={c} value={c}>
                {w[`places.cat.${c}`]}
              </option>
            ))}
          </optgroup>
          <optgroup label={w['places.groupGeneral']}>
            {CURATED_CATEGORIES.filter((c) => !ISRAELI.includes(c)).map((c) => (
              <option key={c} value={c}>
                {w[`places.cat.${c}`]}
              </option>
            ))}
          </optgroup>
        </select>
        {error('category')}
      </div>
      <div className="field">
        <label htmlFor="place-nameHe">{w['places.nameHe']}</label>
        <input
          {...described('nameHe')}
          value={form.nameHe}
          onChange={(e) => set({ nameHe: e.target.value })}
          data-testid="admin-place-name-he"
        />
        {error('nameHe')}
      </div>
      <div className="field">
        <label htmlFor="place-nameEn">{w['places.nameEn']}</label>
        <input
          {...described('nameEn')}
          className="ltr"
          lang="en"
          value={form.nameEn}
          onChange={(e) => set({ nameEn: e.target.value })}
          data-testid="admin-place-name-en"
        />
        {error('nameEn')}
      </div>
      <div className="field">
        <label htmlFor="place-body">{w['places.description']}</label>
        <textarea
          {...described('body')}
          rows={3}
          value={form.body}
          onChange={(e) => set({ body: e.target.value })}
          data-testid="admin-place-description"
        />
        {[...form.body.trim()].length >= 250 ? (
          <span className="help">
            {[...form.body.trim()].length}/{BODY_MAX}
          </span>
        ) : null}
        {error('body')}
      </div>
      <fieldset>
        <legend>{w['places.location']}</legend>
        <div className="field">
          <label htmlFor="place-coords">{w['places.coords']}</label>
          <input
            {...described('coords')}
            className="ltr"
            value={form.coords}
            onChange={(e) => set({ coords: e.target.value })}
            data-testid="admin-place-coords"
          />
          <span className="help">{w['places.coordsHelp']}</span>
          {error('coords')}
          {typeof point === 'object' ? (
            <span className="help" data-testid="admin-place-city">
              {city
                ? w['places.city']!.replace('{{city}}', city.name).replace(
                    '{{km}}',
                    city.km.toFixed(1),
                  )
                : w['places.noCity']}
            </span>
          ) : null}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="place-source">{w['entry.source']}</label>
        <input
          {...described('source')}
          type="url"
          className="ltr"
          value={form.source}
          onChange={(e) => set({ source: e.target.value })}
          data-testid="admin-place-source"
        />
        {error('source')}
      </div>
      <div className="field">
        <label htmlFor="place-verified">{w['entry.verified']}</label>
        <input
          {...described('verified')}
          type="date"
          max={today()}
          value={form.verified}
          onChange={(e) => set({ verified: e.target.value })}
          data-testid="admin-place-verified"
        />
        {error('verified')}
      </div>
      <fieldset>
        <legend>{w['places.status']}</legend>
        {CURATED_STATUSES.map((s) => (
          <label key={s} style={{ marginInlineEnd: 16 }}>
            <input
              type="radio"
              name="status"
              value={s}
              checked={form.status === s}
              onChange={() => set({ status: s })}
              data-testid={`admin-place-status-${s}`}
            />{' '}
            {w[`places.st.${s}`]}
          </label>
        ))}
        <p className="help">{w['places.statusHelp']}</p>
      </fieldset>
      <div className="actions">
        <button
          type="submit"
          className="primary"
          aria-busy={busy}
          disabled={busy || !online}
          data-testid="admin-save"
        >
          {busy ? w.saving : w.save}
        </button>
        <Link
          href="/places"
          onClick={(e) => dirty && !window.confirm(w.leave!) && e.preventDefault()}
        >
          {w.cancel}
        </Link>
      </div>
      {toast ? <Toast text={toast} onDone={() => setToast(null)} /> : null}
    </form>
  );
}
