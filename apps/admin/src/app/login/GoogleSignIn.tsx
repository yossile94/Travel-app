'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { browserClient } from '@/lib/supabase/browser';

/** Design 20.1: Supabase's Google OAuth, back to /auth/callback on this origin. */
export function GoogleSignIn({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="secondary"
      aria-busy={busy}
      disabled={busy}
      data-testid="admin-login-google"
      onClick={async () => {
        setBusy(true);
        const { error } = await browserClient().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) {
          // The technical reason (a missing redirect URI, say) only in the console (design 20.1).
          console.error('[admin] sign-in failed', error.message);
          setBusy(false);
          router.replace('/login?error=failed');
        }
      }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="#EA4335"
          d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
        />
        <path
          fill="#FBBC05"
          d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C1 16.5 0 20.1 0 24s1 7.5 2.7 10.8l7.8-6.1z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"
        />
      </svg>
      {label}
    </button>
  );
}
