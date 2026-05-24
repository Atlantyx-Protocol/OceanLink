// formatters for activity timestamps. relative uses translated short units;
// absolute is a locale-aware full date string.

import type { useTranslations } from 'next-intl';

type Translator = ReturnType<typeof useTranslations<'activity.time'>>;

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;

export function formatRelative(unixSeconds: number, t: Translator, locale: string): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < MINUTE) return t('justNow');
  if (diff < HOUR) return t('minutesAgo', { n: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t('hoursAgo', { n: Math.floor(diff / HOUR) });
  if (diff < WEEK) return t('daysAgo', { n: Math.floor(diff / DAY) });
  return new Date(unixSeconds * 1000).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatAbsolute(unixSeconds: number, locale: string): string {
  return new Date(unixSeconds * 1000).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
