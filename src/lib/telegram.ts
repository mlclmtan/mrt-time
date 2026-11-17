/**
 * Optional public Telegram channel (free alternative to the newsletter),
 * `NEXT_PUBLIC_TELEGRAM_CHANNEL_URL=https://t.me/<channel>`. Only a plain
 * t.me channel link is accepted, so an env value can't point anywhere else.
 */
export function telegramChannelUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  const m = value ? /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/.exec(value) : null;
  return m ? `https://t.me/${m[1]}` : null;
}
