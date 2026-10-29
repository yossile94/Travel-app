'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useOnline } from '@/components/Offline';
import { Toast } from '@/components/Toast';
import { saveEntryAction } from '@/lib/save';
import { entryErrors, type EntryField, type EntryForm, type EntryStatus } from '@/lib/validate';

type Text = Record<
  | 'legend'
  | 'allowed'
  | 'restricted'
  | 'banned'
  | 'none'
  | 'note'
  | 'source'
  | 'sourceHelp'
  | 'verified'
  | 'validityLegend'
  | 'validity'
  | 'validityHelp'
  | 'save'
  | 'saving'
  | 'cancel'
  | 'leave'
  | 'saved'
  | 'saveError'
  | 'rejected'
  | 'denied'
  | 'summaryOne'
  | 'summaryMany'
  | 'noteMax'
  | 'sourceRequired'
  | 'sourceHttps'
  | 'verifiedRequired'
  | 'verifiedFuture'
  | 'months'
  | 'bannedTitle'
  | 'bannedIntro'
  | 'bannedB1'
  | 'bannedB2'
  | 'bannedB3'
  | 'bannedType'
  | 'bannedConfirm'
  | 'unban',
  string
>;

const FIELDS: EntryField[] = ['note', 'source', 'verified', 'months'];
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });

/** Design 21.2, 21.3, AC-19, AC-23: the entry form, checked here and again on the server. */
export function CountryForm({
  adm0,
  initial,
  inherit,
  text,
}: {
  adm0: string;
  name: string;
  initial: EntryForm;
  inherit: string | null;
  text: Text;
}) {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const online = useOnline();
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  // Design 21.2: leaving with unsaved changes asks the browser's question.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const errors = tried ? entryErrors(form, today()) : {};
  const message = (f: EntryField) => (errors[f] ? text[errors[f]] : null);
  const set = (patch: Partial<EntryForm>) => setForm((v) => ({ ...v, ...patch }));

  const send = async () => {
    setBusy(true);
    setServer(null);
    const result = await saveEntryAction(adm0, form).catch(() => ({
      ok: false as const,
      error: 'failed' as const,
    }));
    setBusy(false);
    if (result.ok) {
      setSaved(form);
      setTried(false);
      setToast(text.saved);
      return;
    }
    if ('fields' in result) {
      setTried(true);
      setServer(text.rejected);
    } else {
      setServer(
        result.error === 'denied'
          ? text.denied
          : result.error === 'rejected'
            ? text.rejected
            : text.saveError,
      );
    }
    summary.current?.focus();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(entryErrors(form, today())).length) {
      // Design 21.2: the summary first, with a link to each field.
      setTimeout(() => summary.current?.focus(), 0);
      return;
    }
    // AC-19: turning a country "banned" asks twice: this dialog, and the typed code.
    if (form.status === 'banned' && saved.status !== 'banned') {
      setCode('');
      dialog.current?.showModal();
      return;
    }
    if (saved.status === 'banned' && form.status !== 'banned' && !window.confirm(text.unban))
      return;
    void send();
  };

  const count = Object.keys(errors).length;
  const statuses: (EntryStatus | null)[] = [null, 'allowed', 'restricted', 'banned'];

  return (
    <form onSubmit={submit} noValidate data-testid="admin-country-form">
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
                  <a href={`#entry-${f}`}>{message(f)}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <fieldset>
        <legend>{text.legend}</legend>
        <div className="radios">
          {statuses.map((s) => (
            <label key={s ?? 'none'}>
              <input
                type="radio"
                name="status"
                checked={form.status === s}
                onChange={() => set({ status: s })}
                data-testid={`admin-entry-${s ?? 'none'}`}
              />
              {text[s ?? 'none']}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="entry-note">{text.note}</label>
        <textarea
          id="entry-note"
          rows={3}
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? 'entry-note-error' : 'entry-note-count'}
          data-testid="admin-entry-note"
        />
        <span id="entry-note-count" className="help">
          {[...form.note].length >= 450 ? `${[...form.note].length}/500` : ''}
        </span>
        {errors.note ? (
          <span id="entry-note-error" className="error">
            {message('note')}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="entry-source">{text.source}</label>
        <input
          id="entry-source"
          type="url"
          className="ltr"
          value={form.source}
          onChange={(e) => set({ source: e.target.value })}
          aria-invalid={errors.source ? true : undefined}
          aria-describedby={errors.source ? 'entry-source-error' : 'entry-source-help'}
          data-testid="admin-entry-source"
        />
        <span id="entry-source-help" className="help">
          {text.sourceHelp}
        </span>
        {errors.source ? (
          <span id="entry-source-error" className="error">
            {message('source')}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="entry-verified">{text.verified}</label>
        <input
          id="entry-verified"
          type="date"
          max={today()}
          value={form.verified}
          onChange={(e) => set({ verified: e.target.value })}
          aria-invalid={errors.verified ? true : undefined}
          aria-describedby={errors.verified ? 'entry-verified-error' : undefined}
          data-testid="admin-entry-verified"
        />
        {errors.verified ? (
          <span id="entry-verified-error" className="error">
            {message('verified')}
          </span>
        ) : null}
      </div>

      <fieldset>
        <legend>{text.validityLegend}</legend>
        <div className="field">
          <label htmlFor="entry-months">{text.validity}</label>
          <input
            id="entry-months"
            type="number"
            min={0}
            max={12}
            step={1}
            inputMode="numeric"
            className="ltr"
            value={form.months}
            onChange={(e) => set({ months: e.target.value })}
            aria-invalid={errors.months ? true : undefined}
            aria-describedby={errors.months ? 'entry-months-error' : 'entry-months-help'}
            data-testid="admin-validity-months"
          />
          <span id="entry-months-help" className="help">
            {inherit ?? text.validityHelp}
          </span>
          {errors.months ? (
            <span id="entry-months-error" className="error">
              {message('months')}
            </span>
          ) : null}
        </div>
      </fieldset>

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
          href="/countries"
          onClick={(e) => {
            if (dirty && !window.confirm(text.leave)) e.preventDefault();
          }}
        >
          {text.cancel}
        </Link>
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="banned-title"
        data-testid="admin-banned-dialog"
        onClose={() => setCode('')}
      >
        <h2 id="banned-title">{text.bannedTitle}</h2>
        <p>{text.bannedIntro}</p>
        <ul>
          <li>{text.bannedB1}</li>
          <li>{text.bannedB2}</li>
          <li>{text.bannedB3}</li>
        </ul>
        <div className="field">
          <label htmlFor="banned-code">{text.bannedType}</label>
          <input
            id="banned-code"
            className="ltr"
            autoComplete="off"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="admin-banned-code"
          />
        </div>
        <div className="actions">
          <button
            type="button"
            className="cta"
            aria-disabled={code.trim().toUpperCase() !== adm0}
            data-testid="admin-banned-confirm"
            onClick={() => {
              if (code.trim().toUpperCase() !== adm0) return;
              dialog.current?.close();
              void send();
            }}
          >
            {text.bannedConfirm}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => dialog.current?.close()}
            data-testid="admin-banned-cancel"
          >
            {text.cancel}
          </button>
        </div>
      </dialog>
      {toast ? <Toast text={toast} onDone={() => setToast(null)} /> : null}
    </form>
  );
}
