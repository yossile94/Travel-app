import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireAccess } from '@/lib/access';
import { citiesOf } from '@/lib/cities';
import { countryName } from '@/lib/countries';
import { CURATED_CATEGORIES, CURATED_STATUSES, type CuratedForm } from '@/lib/curated';
import { getT } from '@/lib/locale';
import { serverClient } from '@/lib/supabase/server';

import meta from '../../../../../../mobile/src/features/globe/countryMeta.json';
import { PlaceForm } from './PlaceForm';

export const metadata = { title: 'Curated place' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Design 23.3: /places/new adds; /places/<id> changes. No delete: "hidden" removes it. */
export default async function PlaceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAccess();
  const { t, locale } = await getT();
  const isNew = id === 'new';
  let initial: CuratedForm = {
    adm0: '',
    category: '',
    nameHe: '',
    nameEn: '',
    body: '',
    coords: '',
    source: '',
    verified: '',
    status: 'draft',
  };
  if (!isNew) {
    if (!UUID.test(id)) notFound();
    const supabase = await serverClient();
    const { data } = await supabase
      .from('curated_places')
      .select('adm0, category, name_he, name_en, body, lat, lng, source_url, verified_at, status')
      .eq('id', id)
      .maybeSingle();
    if (!data) notFound();
    initial = {
      adm0: data.adm0 as string,
      category: data.category as string,
      nameHe: data.name_he as string,
      nameEn: data.name_en as string,
      body: (data.body as string | null) ?? '',
      coords: `${data.lat}, ${data.lng}`,
      source: data.source_url as string,
      verified: data.verified_at as string,
      status: data.status as string,
    };
  }
  const countries = Object.keys(meta)
    .map((adm0) => ({ adm0, name: countryName(adm0, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const cities = initial.adm0 ? await citiesOf(initial.adm0) : [];
  const words: Record<string, string> = {};
  for (const key of [
    'places.country',
    'places.category',
    'places.groupIsraeli',
    'places.groupGeneral',
    'places.nameHe',
    'places.nameEn',
    'places.description',
    'places.location',
    'places.coords',
    'places.coordsHelp',
    'places.city',
    'places.noCity',
    'places.status',
    'places.statusHelp',
    'entry.source',
    'entry.verified',
    'save',
    'saving',
    'cancel',
    'leave',
    'saved',
    'saveError',
    'serverRejected',
    'denied',
    'errorSummary.one',
    'errorSummary.many',
    'places.err.country',
    'places.err.category',
    'places.err.nameRequired',
    'places.err.nameMax',
    'places.err.descMax',
    'places.err.coords',
    'places.err.lat',
    'places.err.lng',
    'err.https',
    'err.future',
    'mct.err.source',
    'mct.err.verified',
    ...CURATED_CATEGORIES.map((c) => `places.cat.${c}`),
    ...CURATED_STATUSES.map((s) => `places.st.${s}`),
  ]) {
    words[key] = t(key as never);
  }
  return (
    <div>
      <Link href="/places">‹ {t('places.title')}</Link>
      <h1>{isNew ? t('places.new') : initial.nameHe}</h1>
      <p className="sub">{t('nextLaunch')}</p>
      <PlaceForm
        id={isNew ? null : id}
        initial={initial}
        countries={countries}
        initialCities={cities}
        words={words}
      />
    </div>
  );
}
