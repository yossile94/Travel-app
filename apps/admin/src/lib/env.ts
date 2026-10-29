/**
 * The dev project's URL and publishable key (the same as the app's). Never a
 * secret key: the panel acts only as the signed-in person, so RLS is
 * the enforcement (AC-16, D15).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Design 19: the badge shows while the panel edits the dev project. */
export const DEV_PROJECT_REF = 'xjnflplzqmcsodqyiyyj';
export const isDevProject = () => SUPABASE_URL.includes(DEV_PROJECT_REF);
