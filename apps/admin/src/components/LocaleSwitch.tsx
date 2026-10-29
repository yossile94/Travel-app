import { setLocaleAction } from '@/lib/actions';
import { messages, type Locale } from '@/lib/messages';

/** Design 19: switches Hebrew and English (a cookie), back to the same page. */
export function LocaleSwitch({ locale, back }: { locale: Locale; back: string }) {
  const other: Locale = locale === 'he' ? 'en' : 'he';
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={other} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="link" lang={other} data-testid="admin-locale">
        {messages[locale].locale}
      </button>
    </form>
  );
}
