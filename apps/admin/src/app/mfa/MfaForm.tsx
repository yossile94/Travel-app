'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { browserClient } from '@/lib/supabase/browser';

export interface MfaText {
  title: string;
  sub: string;
  step1: string;
  step2: string;
  qrAlt: string;
  manual: string;
  copy: string;
  copied: string;
  step3: string;
  code: string;
  submit: string;
  wrong: string;
  length: string;
  lost: string;
  error: string;
}

interface Enrolment {
  factorId: string;
  qr: string;
  secret: string;
}

/**
 * Design 20.2, 20.3: the authenticator app (TOTP). "enroll" on the first
 * sign-in shows the QR code and its key; "verify" asks for the code on every
 * sign-in. One field for the 6 digits: it pastes and reads well.
 */
export function MfaForm({ mode, text }: { mode: 'enroll' | 'verify'; text: MfaText }) {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const mfa = browserClient().auth.mfa;
    void (async () => {
      const { data } = await mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === 'verified');
      if (verified) {
        if (mode === 'enroll') return window.location.replace('/mfa/verify');
        setFactorId(verified.id);
        input.current?.focus();
        return;
      }
      if (mode === 'verify') return window.location.replace('/mfa/enroll');
      // An enrolment left half-way (the page closed before the code) starts again.
      for (const f of data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status !== 'verified')
          await mfa.unenroll({ factorId: f.id });
      }
      const { data: made, error: failed } = await mfa.enroll({
        factorType: 'totp',
        friendlyName: 'admin',
      });
      if (failed || !made) return setError(text.error);
      setEnrolment({ factorId: made.id, qr: made.totp.qr_code, secret: made.totp.secret });
      setFactorId(made.id);
    })();
  }, [mode, text.error]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) {
      setError(text.length);
      return input.current?.focus();
    }
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error: failed } = await browserClient().auth.mfa.challengeAndVerify({ factorId, code });
    if (failed) {
      setBusy(false);
      setError(text.wrong);
      setCode('');
      return input.current?.focus();
    }
    // The browser client wrote the AAL2 session to its cookies; the server reads it now.
    router.replace('/');
    router.refresh();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      data-testid={mode === 'enroll' ? 'admin-mfa-enroll' : 'admin-mfa-verify'}
    >
      <h1>{text.title}</h1>
      <p className="sub">{text.sub}</p>
      {mode === 'enroll' ? (
        <ol>
          <li>{text.step1}</li>
          <li>
            {text.step2}
            {enrolment ? (
              <div className="actions" style={{ alignItems: 'flex-start' }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL from Supabase */}
                <img
                  src={enrolment.qr}
                  alt={text.qrAlt}
                  width={160}
                  height={160}
                  data-testid="admin-mfa-qr"
                />
                <div>
                  <p className="help">{text.manual}</p>
                  <code className="ltr" data-testid="admin-mfa-secret">
                    {enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}
                  </code>{' '}
                  <button
                    type="button"
                    className="link"
                    data-testid="admin-mfa-copy"
                    onClick={async () => {
                      await navigator.clipboard.writeText(enrolment.secret);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {text.copy}
                  </button>
                  <span aria-live="polite">{copied ? text.copied : ''}</span>
                </div>
              </div>
            ) : null}
          </li>
          <li>{text.step3}</li>
        </ol>
      ) : null}
      <div className="field">
        <label htmlFor="mfa-code">{text.code}</label>
        <input
          ref={input}
          id="mfa-code"
          className="ltr code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'mfa-error' : undefined}
          data-testid="admin-mfa-code"
        />
        {error ? (
          <span id="mfa-error" className="error" data-testid="admin-mfa-error">
            {error}
          </span>
        ) : null}
      </div>
      <button
        type="submit"
        className="primary"
        aria-busy={busy}
        disabled={busy || !factorId}
        data-testid="admin-mfa-submit"
      >
        {text.submit}
      </button>
      {mode === 'verify' ? <p className="help">{text.lost}</p> : null}
    </form>
  );
}
