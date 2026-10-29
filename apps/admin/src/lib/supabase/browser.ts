'use client';

import { createBrowserClient } from '@supabase/ssr';

import { SUPABASE_KEY, SUPABASE_URL } from '../env';

/** Sign-in and MFA in the browser; everything else goes through the server. */
export const browserClient = () => createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
