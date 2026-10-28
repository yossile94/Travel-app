import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { SUPABASE_KEY, SUPABASE_URL } from '../env';

/** The signed-in person's client, on the server (pages and actions). */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // A page can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
