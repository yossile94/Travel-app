import Link from 'next/link';

import { requireAccess } from '@/lib/access';
import { numDate, PAGE_SIZE } from '@/lib/countries';
import { getT } from '@/lib/locale';
import { serverClient } from '@/lib/supabase/server';

export const metadata = { title: 'MCT' };

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Design 22.1: by IATA, 50 a page; the default 60 minutes said up front. */
export default async function MctPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAccess();
  const { t } = await getT();
  const { q = '', page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const supabase = await serverClient();
  let query = supabase
    .from('min_connection_times')
    .select('iata, minutes, source_url, verified_at', { count: 'exact' })
    .order('iata')
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const needle = q
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (needle) query = query.ilike('iata', `${needle}%`);
  const { data, count, error } = await query;
  const total = count ?? 0;
  const href = (p: number) =>
    `/mct?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div data-testid="admin-mct">
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>{t('mct.title')}</h1>
        <Link className="button primary" href="/mct/new" data-testid="admin-mct-add">
          + {t('mct.add')}
        </Link>
      </div>
      <p className="sub">
        {t('mct.default')} {t('nextLaunch')}
      </p>
      <form className="toolbar" role="search">
        <label className="visually-hidden" htmlFor="q">
          {t('mct.search')}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          className="ltr"
          defaultValue={q}
          placeholder={t('mct.search')}
        />
        <button type="submit" className="secondary">
          {t('mct.search')}
        </button>
      </form>
      {error ? (
        <p className="alert" role="alert">
          {t('loadError')} <Link href="/mct">{t('retry')}</Link>
        </p>
      ) : !data?.length ? (
        <p>{needle ? t('mct.notFound') : t('mct.empty')}</p>
      ) : (
        <table>
          <caption className="visually-hidden">{t('mct.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('mct.col.iata')}</th>
              <th scope="col">{t('mct.col.minutes')}</th>
              <th scope="col">{t('mct.col.source')}</th>
              <th scope="col">{t('mct.col.verified')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.iata as string} data-testid={`admin-mct-row-${r.iata}`}>
                <td className="ltr">
                  <Link href={`/mct/${r.iata}`}>{r.iata as string}</Link>
                </td>
                <td>{r.minutes as number}</td>
                <td className="ltr">
                  <a href={r.source_url as string} target="_blank" rel="noopener noreferrer">
                    {host(r.source_url as string)}
                  </a>
                </td>
                <td>{numDate(r.verified_at as string)}</td>
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
