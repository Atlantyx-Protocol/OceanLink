import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from './config';

// resolves the active locale per-request from a cookie. no URL prefix —
// switching is handled via a setLocale action that writes the cookie.
export default getRequestConfig(async () => {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
