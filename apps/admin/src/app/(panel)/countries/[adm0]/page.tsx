import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireAccess } from '@/lib/access';
import { countryName, sovereignOf } from '@/lib/countries';
import { getT } from '@/lib/locale';
import { serverClient } from '@/lib/supabase/server';

import { CountryForm } from './CountryForm';

export const metadata = { title: 'Entry' };

/** Design 21.2: one area's entry and passport validity. */
export default async function CountryPage({ params }: { params: Promise<{ adm0: string }> }) {
  const { adm0 } = await params;
  if (!/^[A-Z0-9]{3}$/.test(adm0)) notFound();
  const access = await requireAccess();
  const { t, locale } = await getT();
  const supabase = await serverClient();
  const { data: row } = await supabase
    .from('country_advisories')
    .select(
      'adm0, entry_status, entry_note, entry_source_url, entry_verified_at, passport_validity_months, nsc_level',
    )
    .eq('adm0', adm0)
    .maybeSingle();
  if (!row) notFound();
  const name = countryName(adm0, locale);
  const sovereign = sovereignOf(adm0);
  let inherit: string | null = null;
  if (sovereign) {
    const { data: parent } = await supabase
      .from('country_advisories')
      .select('passport_validity_months')
      .eq('adm0', sovereign)
      .maybeSingle();
    const n = parent?.passport_validity_months as number | null | undefined;
    inherit =
      n === null || n === undefined
        ? t('entry.validityInheritDefault', { sovereign: countryName(sovereign, locale) })
        : t('entry.validityInherit', { sovereign: countryName(sovereign, locale), n });
  }
  // "Last updated" comes from the log, which only an admin reads (design 21.2).
  let last: string | null = null;
  if (access.roles.includes('admin')) {
    const { data: log } = await supabase
      .from('admin_audit_log')
      .select('created_at, actor_email')
      .eq('entity', 'country_advisories')
      .eq('entity_id', adm0)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (log) {
      const when = new Date(log.created_at as string).toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        dateStyle: 'short',
        timeStyle: 'short',
      });
      last = t('entry.lastUpdated', {
        when,
        who: (log.actor_email as string | null) ?? t('audit.system'),
      });
    }
  }
  const level = row.nsc_level as number | null;

  return (
    <div>
      <Link href="/countries">‹ {t('entry.title')}</Link>
      <h1>
        {name} <span className="ltr tag">{adm0}</span>
      </h1>
      <p className="sub">
        {level ? t('entry.level', { n: level }) : t('entry.levelNone')}
        <br />
        {t('nextLaunch')}
      </p>
      <CountryForm
        adm0={adm0}
        name={name}
        initial={{
          status: (row.entry_status as 'allowed' | 'restricted' | 'banned' | null) ?? null,
          note: (row.entry_note as string | null) ?? '',
          source: (row.entry_source_url as string | null) ?? '',
          verified: (row.entry_verified_at as string | null) ?? '',
          months: row.passport_validity_months === null ? '' : String(row.passport_validity_months),
        }}
        inherit={inherit}
        text={{
          legend: t('entry.legend'),
          allowed: t('entry.allowed'),
          restricted: t('entry.restricted'),
          banned: t('entry.banned'),
          none: t('entry.none'),
          note: t('entry.note'),
          source: t('entry.source'),
          sourceHelp: t('entry.sourceHelp'),
          verified: t('entry.verified'),
          validityLegend: t('entry.validityLegend'),
          validity: t('entry.validity'),
          validityHelp: t('entry.validityHelp'),
          save: t('save'),
          saving: t('saving'),
          cancel: t('cancel'),
          leave: t('leave'),
          saved: t('saved'),
          saveError: t('saveError'),
          rejected: t('serverRejected'),
          denied: t('denied'),
          summaryOne: t('errorSummary.one'),
          summaryMany: t('errorSummary.many'),
          noteMax: t('entry.err.noteMax'),
          sourceRequired: t('entry.err.sourceRequired'),
          sourceHttps: t('err.https'),
          verifiedRequired: t('entry.err.verifiedRequired'),
          verifiedFuture: t('err.future'),
          months: t('entry.err.months'),
          bannedTitle: t('banned.title', { country: name }),
          bannedIntro: t('banned.intro'),
          bannedB1: t('banned.b1', { country: name }),
          bannedB2: t('banned.b2'),
          bannedB3: t('banned.b3', { country: name }),
          bannedType: t('banned.type', { code: adm0 }),
          bannedConfirm: t('banned.confirm'),
          unban: t('unban', { country: name }),
        }}
      />
      {last ? <p className="help">{last}</p> : null}
    </div>
  );
}
