import Link from 'next/link';

import { requireAccess } from '@/lib/access';
import { numDate } from '@/lib/countries';
import { getT } from '@/lib/locale';
import type { MessageKey } from '@/lib/messages';
import { serverClient } from '@/lib/supabase/server';
import { ROLES, type Role } from '@/lib/validate';

import { RolesClient, type Person } from './RolesClient';

export const metadata = { title: 'Roles' };

/** Design 24 (AC-17, D12): admins only; granting by email, removing by the tag. */
export default async function RolesPage() {
  const access = await requireAccess('admin');
  const { t } = await getT();
  const supabase = await serverClient();
  const { data, error } = await supabase.rpc('admin_role_list');
  if (error) {
    return (
      <>
        <h1>{t('roles.title')}</h1>
        <p className="alert" role="alert">
          {t('loadError')} <Link href="/roles">{t('retry')}</Link>
        </p>
      </>
    );
  }
  const byUser = new Map<string, Person>();
  for (const r of (data ?? []) as {
    user_id: string;
    email: string;
    role: Role;
    created_at: string;
  }[]) {
    const p = byUser.get(r.user_id) ?? {
      userId: r.user_id,
      email: r.email,
      roles: [],
      added: r.created_at,
    };
    p.roles.push(r.role);
    if (r.created_at < p.added) p.added = r.created_at;
    byUser.set(r.user_id, p);
  }
  const people = [...byUser.values()];
  const admins = people.filter((p) => p.roles.includes('admin')).length;
  const roleName = (r: Role) => t(`role.${r}` as MessageKey);

  return (
    <div data-testid="admin-roles">
      <h1>{t('roles.title')}</h1>
      <RolesClient
        me={access.userId}
        people={people.map((p) => ({ ...p, added: numDate(p.added) }))}
        lastAdmin={admins <= 1}
        roles={ROLES.map((r) => ({
          value: r,
          label:
            r === 'support' || r === 'moderator'
              ? `${roleName(r)} ${t('roles.noScreens')}`
              : roleName(r),
          name: roleName(r),
        }))}
        text={{
          add: t('roles.add'),
          email: t('roles.email'),
          role: t('roles.role'),
          addButton: t('roles.addButton'),
          help: t('roles.help'),
          caption: t('roles.caption'),
          colUser: t('roles.col.user'),
          colRoles: t('roles.col.roles'),
          colAdded: t('roles.col.added'),
          you: t('roles.you'),
          self: t('roles.self'),
          lastAdmin: t('roles.lastAdmin'),
          removeA11y: t('roles.removeA11y'),
          removeConfirm: t('roles.removeConfirm'),
          removed: t('roles.removed'),
          added: t('roles.added'),
          noUser: t('roles.err.noUser'),
          has: t('roles.err.has'),
          badEmail: t('roles.err.email'),
          denied: t('denied'),
          failed: t('saveError'),
        }}
      />
    </div>
  );
}
