import { redirect } from 'next/navigation';

import { requireAccess } from '@/lib/access';

/** The first page is "Entry for Israelis"; requireAccess sends others where they belong. */
export default async function Home() {
  await requireAccess();
  redirect('/countries');
}
