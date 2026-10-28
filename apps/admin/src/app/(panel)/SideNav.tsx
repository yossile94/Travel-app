'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';

/** Design 19.1: the sections by role; the current one marked for screen readers too. */
export function SideNav({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; id: string; divider?: boolean }[];
}) {
  const path = usePathname();
  return (
    <nav className="side" aria-label={label}>
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.divider ? <hr /> : null}
          <Link
            href={item.href}
            aria-current={path.startsWith(item.href) ? 'page' : undefined}
            data-testid={`admin-nav-${item.id}`}
          >
            {item.label}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
