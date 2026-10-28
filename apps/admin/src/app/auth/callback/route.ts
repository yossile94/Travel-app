import { NextResponse, type NextRequest } from 'next/server';

import { serverClient } from '@/lib/supabase/server';

/** Design 20.1: back from Google. The code becomes a session; MFA comes next. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  if (url.searchParams.get('error')) {
    const cancelled = url.searchParams.get('error') === 'access_denied';
    return to(`/login?error=${cancelled ? 'cancelled' : 'failed'}`);
  }
  if (!code) return to('/login?error=failed');
  const supabase = await serverClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[admin] callback failed', error.code ?? error.name);
    return to('/login?error=failed');
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return to(aal?.nextLevel === 'aal2' ? '/mfa/verify' : '/mfa/enroll');
}
