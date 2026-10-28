import { signOutAction } from '@/lib/actions';

export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className="link" data-testid="admin-sign-out">
        {label}
      </button>
    </form>
  );
}
