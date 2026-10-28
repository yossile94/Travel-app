'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { useOnline } from '@/components/Offline';
import { Toast } from '@/components/Toast';
import { saveMctAction } from '@/lib/save';
import { mctErrors, type MctError, type MctField, type MctForm as Form } from '@/lib/validate';

type Text = Record<
  | 'iata'
  | 'minutes'
  | 'source'
  | 'sourceHelp'
  | 'verified'
  | 'save'
  | 'saving'
  | 'cancel'
  | 'leave'
  | 'saved'
  | 'saveError'
  | 'rejected'
  | 'denied'
  | 'exists'
  | 'summaryOne'
  | 'summaryMany'
  | 'errIata'
  | 'errMinutes'
  | 'errSource'
  | 'errHttps'
  | 'errVerified'
  | 'errFuture',
  string
>;

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
const FIELDS: MctField[] = ['iata', 'minutes', 'source', 'verified'];

/** Design 22.2, AC-22, AC-23. */
export function MctForm({ isNew, initial, text }: { isNew: boolean; initial: Form; text: Text }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const online = useOnline();
  const errors = tried ? mctErrors(form, today()) : {};
  const words: Record<MctError, string> = {
    iata: text.errIata,
    minutes: text.errMinutes,
    sourceRequired: text.errSource,
    sourceHttps: text.errHttps,
    verifiedRequired: text.errVerified,
    verifiedFuture: text.errFuture,
  };
  const msg = (f: MctField) => (errors[f] ? words[errors[f]] : null);
  const set = (patch: Partial<Form>) => setForm((v) => ({ ...v, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(mctErrors(form, today())).length)
      return setTimeout(() => summary.current?.focus(), 0);
    setBusy(true);
    setServer(null);
    const result = await saveMctAction(form, isNew).catch(() => ({
      ok: false as const,
      error: 'failed' as const,
    }));
    setBusy(false);
    if (result.ok) {
      if (isNew) return router.push(`/mct/${form.iata.trim().toUpperCase()}`);
      return setToast(text.saved);
    }
    setServer(
      'fields' in result
        ? text.rejected
        : result.error === 'exists'
          ? text.exists
          : result.error === 'denied'
            ? text.denied
            : result.error === 'rejected'
              ? text.rejected
              : text.saveError,
    );
    summary.current?.focus();
  };

  const count = Object.keys(errors).length;
  const input = (f: MctField, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      id={`mct-${f}`}
      aria-invalid={errors[f] ? true : undefined}
      aria-describedby={errors[f] ? `mct-${f}-error` : undefined}
      data-testid={`admin-mct-${f}`}
      {...props}
    />
  );

  return (
    <form onSubmit={submit} noValidate data-testid="admin-mct-form">
      {count || server ? (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="alert"
          data-testid="admin-error-summary"
        >
          {server ??
            (count === 1 ? text.summaryOne : text.summaryMany.replace('{{n}}', String(count)))}
          {count ? (
            <ul>
              {FIELDS.filter((f) => errors[f]).map((f) => (
                <li key={f}>
                  <a href={`#mct-${f}`}>{msg(f)}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="mct-iata">{text.iata}</label>
        {input('iata', {
          className: 'ltr',
          maxLength: 3,
          readOnly: !isNew,
          value: form.iata,
          onChange: (e) => set({ iata: e.target.value.toUpperCase() }),
        })}
        {errors.iata ? (
          <span id="mct-iata-error" className="error">
            {msg('iata')}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="mct-minutes">{text.minutes}</label>
        {input('minutes', {
          type: 'number',
          min: 15,
          max: 360,
          className: 'ltr',
          value: form.minutes,
          onChange: (e) => set({ minutes: e.target.value }),
        })}
        {errors.minutes ? (
          <span id="mct-minutes-error" className="error">
            {msg('minutes')}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="mct-source">{text.source}</label>
        {input('source', {
          type: 'url',
          className: 'ltr',
          value: form.source,
          onChange: (e) => set({ source: e.target.value }),
        })}
        <span className="help">{text.sourceHelp}</span>
        {errors.source ? (
          <span id="mct-source-error" className="error">
            {msg('source')}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="mct-verified">{text.verified}</label>
        {input('verified', {
          type: 'date',
          max: today(),
          value: form.verified,
          onChange: (e) => set({ verified: e.target.value }),
        })}
        {errors.verified ? (
          <span id="mct-verified-error" className="error">
            {msg('verified')}
          </span>
        ) : null}
      </div>
      <div className="actions">
        <button
          type="submit"
          className="primary"
          aria-busy={busy}
          disabled={busy || !online}
          data-testid="admin-save"
        >
          {busy ? text.saving : text.save}
        </button>
        <Link
          href="/mct"
          onClick={(e) => dirty && !window.confirm(text.leave) && e.preventDefault()}
        >
          {text.cancel}
        </Link>
      </div>
      {toast ? <Toast text={toast} onDone={() => setToast(null)} /> : null}
    </form>
  );
}
