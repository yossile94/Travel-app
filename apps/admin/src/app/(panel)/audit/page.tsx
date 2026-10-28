import Link from 'next/link';

import { requireAccess } from '@/lib/access';
import { PAGE_SIZE } from '@/lib/countries';
import { getT } from '@/lib/locale';
import type { MessageKey } from '@/lib/messages';
import { serverClient } from '@/lib/supabase/server';

export const metadata = { title: 'Audit' };

interface Entry {
  id: number;
  actor_email: string | null;
  action: 'insert' | 'update' | 'delete';
  entity: string;
  entity_id: string;
  diff: Record<string, { old: unknown; new: unknown }>;
  created_at: string;
}

const when = (iso: string) =>
  new Date(iso)
    .toLocaleString('en-GB', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(/\//g, '.')
    .replace(',', '');

/**
 * Design 23 (AC-18, D11): read only, newest first, 50 a page, paged by the
 * key (created_at, id) so a new entry never shifts the page.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string }>;
}) {
  await requireAccess('admin');
  const { t } = await getT();
  const { before, after } = await searchParams;
  const cursor = (v: string | undefined) => {
    const [at, id] = (v ?? '').split('_');
    const iso = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
    return at && iso.test(at) && /^\d+$/.test(id ?? '') ? { at, id: Number(id) } : null;
  };
  const older = cursor(before);
  const newer = cursor(after);
  const supabase = await serverClient();
  let query = supabase
    .from('admin_audit_log')
    .select('id, actor_email, action, entity, entity_id, diff, created_at')
    .limit(PAGE_SIZE + 1);
  if (older) {
    query = query
      .or(`created_at.lt.${older.at},and(created_at.eq.${older.at},id.lt.${older.id})`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
  } else if (newer) {
    query = query
      .or(`created_at.gt.${newer.at},and(created_at.eq.${newer.at},id.gt.${newer.id})`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false });
  }
  const { data, error } = await query;
  let rows = ((data ?? []) as Entry[]).slice(0, PAGE_SIZE);
  const more = (data?.length ?? 0) > PAGE_SIZE;
  if (newer) rows = rows.reverse();
  const key = (r: Entry) => `${encodeURIComponent(r.created_at)}_${r.id}`;
  const hasOlder = newer ? true : more;
  const hasNewer = older ? true : newer ? more : false;
  const value = (v: unknown) =>
    v === null || v === undefined
      ? t('audit.null')
      : String(typeof v === 'object' ? JSON.stringify(v) : v);

  return (
    <div data-testid="admin-audit">
      <h1>{t('audit.title')}</h1>
      <p className="sub">{t('audit.caption')}</p>
      {error ? (
        <p className="alert" role="alert">
          {t('loadError')} <Link href="/audit">{t('retry')}</Link>
        </p>
      ) : !rows.length ? (
        <p>{t('audit.empty')}</p>
      ) : (
        <table>
          <caption className="visually-hidden">{t('audit.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('audit.col.when')}</th>
              <th scope="col">{t('audit.col.who')}</th>
              <th scope="col">{t('audit.col.row')}</th>
              <th scope="col">{t('audit.col.action')}</th>
              <th scope="col">{t('audit.col.diff')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const fields = Object.entries(r.diff ?? {});
              return (
                <tr key={r.id} data-testid={`admin-audit-row-${r.id}`}>
                  <td>
                    <time dateTime={r.created_at}>{when(r.created_at)}</time>
                  </td>
                  <td className="ltr">{r.actor_email ?? t('audit.system')}</td>
                  <td>
                    {t(`audit.table.${r.entity}` as MessageKey)} ·{' '}
                    <span className="ltr">{r.entity_id}</span>
                  </td>
                  <td>{t(`audit.${r.action}`)}</td>
                  <td>
                    <details data-testid={`admin-audit-diff-${r.id}`}>
                      <summary>
                        {fields.length === 1
                          ? t('audit.fieldsOne')
                          : t('audit.fieldsMany', { n: fields.length })}
                      </summary>
                      <ul className="ltr">
                        {fields.map(([col, d]) => (
                          <li key={col}>
                            <code>{col}</code>: {value(d.old).slice(0, 200)} →{' '}
                            {value(d.new).slice(0, 200)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="pager">
        {hasNewer && rows.length ? (
          <Link className="button secondary" href={`/audit?after=${key(rows[0]!)}`}>
            {t('newer')}
          </Link>
        ) : null}
        {hasOlder && rows.length ? (
          <Link className="button secondary" href={`/audit?before=${key(rows[rows.length - 1]!)}`}>
            {t('older')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
