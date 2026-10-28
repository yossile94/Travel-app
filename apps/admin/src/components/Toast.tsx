'use client';

import { useEffect } from 'react';

/** Design 25.6: 5 s, bottom corner at the end side, read by screen readers. */
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 5000);
    return () => clearTimeout(timer);
  }, [text, onDone]);
  return (
    <div className="toast" role="status" data-testid="admin-toast">
      {text}
    </div>
  );
}
