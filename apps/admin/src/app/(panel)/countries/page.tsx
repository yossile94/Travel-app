import Link from 'next/link';

import { requireAccess } from '@/lib/access';
import {
  countryName,
  filterRows,
  numDate,
  PAGE_SIZE,
  type Row,
  type StatusFilter,
} from '@/lib/countries';
import { getT } from '@/lib/locale';
import { serverClient } from '@/lib/supabase/server';

export const metadata = { title: 'Entry' };

const FILTERS: StatusFilter[] = ['all', 'allowed', 'restricted', 'banned', 'none'];

/** Design 21.1: every area with its entry status, 50 a page, the page in the URL. */
export default async function CountriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAccess();
  const { t, locale } = await getT();
  const params = await searchParams;
  const q = params.q ?? '';
  const status = (FILTERS as string[]).includes(params.status ?? '')
    ? (params.status as StatusFilter)
    : 'all';
  const supabase = await serverClient();
  const { data, error } = await supabase
    .from('country_advisories')
    .select('adm0, entry_status, entry_verified_at, passport_validity_months, nsc_level');
  if (error) {
    return (
      <>
        <h1>{t('entry.title')}</h1>
        <p className="alert" role="alert">
          {t('loadError')} <Link href="/countries">{t('retry')}</Link>
        </p>
      </>
    );
  }
  const rows = filterRows((data ?? []) as Row[], q, status, locale);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const href = (p: number) =>
    `/countries?${new URLSearchParams({ ...(q ? { q } : {}), ...(status !== 'all' ? { status } : {}), page: String(p) })}`;
  const tag = (s: Row['entry_status']) => (
    <span className={`tag ${s ? `entry-${s}` : ''}`}>{t(`entry.${s ?? 'none'}`)}</span>
  );

  return (
    <div data-testid="admin-countries">
      <h1>{t('entry.title')}</h1>
      <p className="sub">{t('nextLaunch')}</p>
      <form className="toolbar" role="search">
        <label className="visually-hidden" htmlFor="q">
          {t('entry.search')}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t('entry.search')}
          data-testid="admin-countries-search"
        />
        <label htmlFor="status">{t('entry.filter')}</label>
        <select
          id="status"
          name="status"
          defaultValue={status}
          data-testid="admin-countries-filter"
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(f === 'all' ? 'entry.all' : `entry.${f}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary">
          {t('entry.search')}
        </button>
      </form>
      {shown.length === 0 ? (
        <p>{t('entry.empty')}</p>
      ) : (
        <table>
          <caption className="visually-hidden">{t('entry.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('entry.col.country')}</th>
              <th scope="col">{t('entry.col.code')}</th>
              <th scope="col">{t('entry.col.status')}</th>
              <th scope="col">{t('entry.col.validity')}</th>
              <th scope="col">{t('entry.col.verified')}</th>
              <th scope="col">{t('entry.col.level')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.adm0} data-testid={`admin-country-row-${r.adm0}`}>
                <td>
                  <Link href={`/countries/${r.adm0}`}>{countryName(r.adm0, locale)}</Link>
                </td>
                <td className="ltr">{r.adm0}</td>
                <td>{tag(r.entry_status)}</td>
                <td>{r.passport_validity_months ?? '—'}</td>
                <td>{numDate(r.entry_verified_at)}</td>
                <td>{r.nsc_level ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pager">
        <span>
          {t('pager', {
            from: rows.length ? (page - 1) * PAGE_SIZE + 1 : 0,
            to: Math.min(page * PAGE_SIZE, rows.length),
            total: rows.length,
          })}
        </span>
        {page > 1 ? (
          <Link className="button secondary" href={href(page - 1)} data-testid="admin-pager-prev">
            {t('prev')}
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="button secondary" href={href(page + 1)} data-testid="admin-pager-next">
            {t('next')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
