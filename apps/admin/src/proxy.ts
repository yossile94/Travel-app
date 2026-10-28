/**
 * Keeps the Supabase session fresh on every request (its cookies), and sends
 * a signed-out visitor to /login. The page itself checks MFA and roles on the
 * server (lib/access.ts); the database enforces them (RLS).
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SUPABASE_KEY, SUPABASE_URL } from './lib/env';

const OPEN = ['/login', '/auth/callback'];

export async function proxy(request: NextRequest) {
  // The shell's language switch returns to this page.
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search);
  const next = () => NextResponse.next({ request: { headers } });
  let response = next();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!data.user && !OPEN.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = request.cookies.getAll().some((c) => c.name.includes('auth-token'))
      ? '?expired=1'
      : '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
