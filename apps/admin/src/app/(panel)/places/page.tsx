import Link from 'next/link';

import { requireAccess } from '@/lib/access';
import { countryName, numDate, PAGE_SIZE } from '@/lib/countries';
import { CURATED_STATUSES } from '@/lib/curated';
import { getT } from '@/lib/locale';
import { serverClient } from '@/lib/supabase/server';

export const metadata = { title: 'Curated places' };

/** A search word safe inside a PostgREST or() filter: letters, digits and spaces. */
const safeNeedle = (q: string) =>
  q
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .slice(0, 60);

/** Design 23.2: by country, then Hebrew name; 50 a page; search and filters on the server. */
export default async function PlacesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; country?: string; status?: string; page?: string }>;
}) {
  await requireAccess();
  const { t, locale } = await getT();
  const { q = '', country = '', status = '', page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const supabase = await serverClient();
  let query = supabase
    .from('curated_places')
    .select('id, adm0, category, name_he, name_en, status, verified_at, updated_at', {
      count: 'exact',
    })
    .order('adm0')
    .order('name_he')
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const needle = safeNeedle(q);
  if (needle) query = query.or(`name_he.ilike.%${needle}%,name_en.ilike.%${needle}%`);
  if (/^[A-Z0-9]{3}$/.test(country)) query = query.eq('adm0', country);
  if ((CURATED_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  const { data, count, error } = await query;
  const total = count ?? 0;
  const href = (p: number) =>
    `/places?${new URLSearchParams({ ...(q ? { q } : {}), ...(country ? { country } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <div data-testid="admin-places">
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>{t('places.title')}</h1>
        <Link className="button primary" href="/places/new" data-testid="admin-places-add">
          + {t('places.add')}
        </Link>
      </div>
      <p className="sub">{t('nextLaunch')}</p>
      <form className="toolbar" role="search">
        <label className="visually-hidden" htmlFor="q">
          {t('places.search')}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t('places.search')}
          data-testid="admin-places-search"
        />
        <label htmlFor="country">{t('places.country')}</label>
        <input
          id="country"
          name="country"
          className="ltr"
          maxLength={3}
          size={4}
          defaultValue={country}
          data-testid="admin-places-country"
        />
        <label htmlFor="status">{t('places.status')}</label>
        <select id="status" name="status" defaultValue={status} data-testid="admin-places-status">
          <option value="">{t('places.all')}</option>
          {CURATED_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`places.st.${s}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary">
          {t('places.search')}
        </button>
      </form>
      {error ? (
        <p className="alert" role="alert">
          {t('loadError')} <Link href="/places">{t('retry')}</Link>
        </p>
      ) : !data?.length ? (
        <p>{needle || country || status ? t('places.noResults') : t('places.empty')}</p>
      ) : (
        <table>
          <caption className="visually-hidden">{t('places.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('places.col.name')}</th>
              <th scope="col">{t('places.country')}</th>
              <th scope="col">{t('places.col.category')}</th>
              <th scope="col">{t('places.status')}</th>
              <th scope="col">{t('places.col.verified')}</th>
              <th scope="col">{t('places.col.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id as string} data-testid={`admin-place-row-${r.id}`}>
                <td>
                  <Link href={`/places/${r.id}`}>{r.name_he as string}</Link>
                  <div className="sub ltr" lang="en">
                    {r.name_en as string}
                  </div>
                </td>
                <td>{countryName(r.adm0 as string, locale)}</td>
                <td>{t(`places.cat.${r.category as string}` as never)}</td>
                <td>
                  <span className={`tag tag-${r.status as string}`}>
                    {t(`places.st.${r.status as string}` as never)}
                  </span>
                </td>
                <td>{numDate(r.verified_at as string)}</td>
                <td>{numDate((r.updated_at as string).slice(0, 10))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pager">
        {total ? (
          <span>
            {t('pager', {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
              total,
            })}
          </span>
        ) : null}
        {page > 1 ? (
          <Link className="button secondary" href={href(page - 1)} data-testid="admin-pager-prev">
            {t('prev')}
          </Link>
        ) : null}
        {page * PAGE_SIZE < total ? (
          <Link className="button secondary" href={href(page + 1)} data-testid="admin-pager-next">
            {t('next')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
