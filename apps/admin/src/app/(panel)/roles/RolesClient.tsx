'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Toast } from '@/components/Toast';
import { grantRoleAction, revokeRoleAction, type SaveResult } from '@/lib/save';
import { isEmail, type Role } from '@/lib/validate';

export interface Person {
  userId: string;
  email: string;
  roles: Role[];
  added: string;
}

type Text = Record<
  | 'add'
  | 'email'
  | 'role'
  | 'addButton'
  | 'help'
  | 'caption'
  | 'colUser'
  | 'colRoles'
  | 'colAdded'
  | 'you'
  | 'self'
  | 'lastAdmin'
  | 'removeA11y'
  | 'removeConfirm'
  | 'removed'
  | 'added'
  | 'noUser'
  | 'has'
  | 'badEmail'
  | 'denied'
  | 'failed',
  string
>;

const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

/** Design 24: grant by email; remove with the ✕ on a tag; never your own, never the last admin. */
export function RolesClient({
  me,
  people,
  roles,
  lastAdmin,
  text,
}: {
  me: string;
  people: Person[];
  roles: { value: Role; label: string; name: string }[];
  lastAdmin: boolean;
  text: Text;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('content_editor');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (r: Role) => roles.find((x) => x.value === r)?.name ?? r;

  const explain = (r: Exclude<SaveResult, { ok: true }>) =>
    'fields' in r
      ? text.failed
      : r.error === 'noUser'
        ? text.noUser
        : r.error === 'has'
          ? text.has
          : r.error === 'email'
            ? text.badEmail
            : r.error === 'self'
              ? text.self
              : r.error === 'lastAdmin'
                ? text.lastAdmin
                : r.error === 'denied'
                  ? text.denied
                  : text.failed;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError(text.badEmail);
    setBusy(true);
    setError(null);
    const result = await grantRoleAction(email, role).catch(() => ({
      ok: false as const,
      error: 'failed' as const,
    }));
    setBusy(false);
    if (!result.ok) return setError(explain(result));
    setEmail('');
    setToast(text.added);
    router.refresh();
  };

  const remove = async (p: Person, r: Role) => {
    if (!window.confirm(fill(text.removeConfirm, { role: name(r), email: p.email }))) return;
    const result = await revokeRoleAction(p.userId, r).catch(() => ({
      ok: false as const,
      error: 'failed' as const,
    }));
    if (!result.ok) return setToast(explain(result));
    setToast(text.removed);
    router.refresh();
  };

  return (
    <>
      <form onSubmit={add} noValidate>
        <fieldset>
          <legend>{text.add}</legend>
          <div className="toolbar" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="role-email">{text.email}</label>
              <input
                id="role-email"
                type="email"
                className="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'role-error' : 'role-help'}
                data-testid="admin-roles-email"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="role-role">{text.role}</label>
              <select
                id="role-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                data-testid="admin-roles-role"
              >
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="primary"
              aria-busy={busy}
              disabled={busy}
              data-testid="admin-roles-add"
            >
              {text.addButton}
            </button>
          </div>
          <p id="role-help" className="help">
            {text.help}
          </p>
          {error ? (
            <p id="role-error" className="error" role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
      </form>
      <table>
        <caption className="visually-hidden">{text.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{text.colUser}</th>
            <th scope="col">{text.colRoles}</th>
            <th scope="col">{text.colAdded}</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const self = p.userId === me;
            return (
              <tr key={p.userId} data-testid={`admin-roles-row-${p.userId}`}>
                <td>
                  <span className="ltr">{p.email}</span> {self ? text.you : null}
                  {self ? <div className="help">{text.self}</div> : null}
                </td>
                <td>
                  {p.roles.map((r) => {
                    const blocked = r === 'admin' && lastAdmin;
                    return (
                      <span key={r} className="tag" style={{ marginInlineEnd: 6 }}>
                        {name(r)}
                        {self ? null : (
                          <button
                            type="button"
                            className="link"
                            style={{ minHeight: 32, padding: '0 6px' }}
                            aria-label={fill(text.removeA11y, { role: name(r), email: p.email })}
                            aria-disabled={blocked ? true : undefined}
                            title={blocked ? text.lastAdmin : undefined}
                            onClick={() => !blocked && void remove(p, r)}
                            data-testid={`admin-roles-remove-${p.userId}-${r}`}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {!self && lastAdmin && p.roles.includes('admin') ? (
                    <div className="help" data-testid="admin-roles-last-admin">
                      {text.lastAdmin}
                    </div>
                  ) : null}
                </td>
                <td>{p.added}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {toast ? <Toast text={toast} onDone={() => setToast(null)} /> : null}
    </>
  );
}
