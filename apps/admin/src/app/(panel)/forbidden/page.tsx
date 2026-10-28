import Link from 'next/link';

import { getT } from '@/lib/locale';

/** Design 20.4: an Admin page for someone who isn't, inside the shell. */
export default async function ForbiddenPage() {
  const { t } = await getT();
  return (
    <div data-testid="admin-forbidden">
      <h1>{t('forbidden')}</h1>
      <Link href="/countries">{t('backToEntry')}</Link>
    </div>
  );
}
