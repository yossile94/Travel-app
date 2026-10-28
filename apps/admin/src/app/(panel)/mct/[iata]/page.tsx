import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireAccess } from '@/lib/access';
import { getT } from '@/lib/locale';
import { serverClient } from '@/lib/supabase/server';

import { MctForm } from './MctForm';

export const metadata = { title: 'MCT' };

/** Design 22.2: /mct/new adds; /mct/IST changes (the code itself is the key). */
export default async function MctEditPage({ params }: { params: Promise<{ iata: string }> }) {
  const { iata } = await params;
  await requireAccess();
  const { t } = await getT();
  const isNew = iata === 'new';
  let initial = { iata: '', minutes: '', source: '', verified: '' };
  if (!isNew) {
    if (!/^[A-Z]{3}$/.test(iata)) notFound();
    const supabase = await serverClient();
    const { data } = await supabase
      .from('min_connection_times')
      .select('iata, minutes, source_url, verified_at')
      .eq('iata', iata)
      .maybeSingle();
    if (!data) notFound();
    initial = {
      iata: data.iata as string,
      minutes: String(data.minutes),
      source: data.source_url as string,
      verified: data.verified_at as string,
    };
  }
  return (
    <div>
      <Link href="/mct">‹ {t('mct.title')}</Link>
      <h1>{isNew ? t('mct.newTitle') : <span className="ltr">{iata}</span>}</h1>
      <p className="sub">{t('nextLaunch')}</p>
      <MctForm
        isNew={isNew}
        initial={initial}
        text={{
          iata: t('mct.col.iata'),
          minutes: t('mct.minutes'),
          source: t('entry.source'),
          sourceHelp: t('mct.sourceHelp'),
          verified: t('entry.verified'),
          save: t('save'),
          saving: t('saving'),
          cancel: t('cancel'),
          leave: t('leave'),
          saved: t('saved'),
          saveError: t('saveError'),
          rejected: t('serverRejected'),
          denied: t('denied'),
          exists: t('mct.err.exists'),
          notFound: t('mct.notFound'),
          summaryOne: t('errorSummary.one'),
          summaryMany: t('errorSummary.many'),
          errIata: t('mct.err.iata'),
          errMinutes: t('mct.err.minutes'),
          errSource: t('mct.err.source'),
          errHttps: t('err.https'),
          errVerified: t('mct.err.verified'),
          errFuture: t('err.future'),
        }}
      />
    </div>
  );
}
