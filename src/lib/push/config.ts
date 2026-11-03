/** Feature switches derived from env; nothing throws when unset. */
const has = (key: string) => Boolean(process.env[key]?.trim());

/** Web Push can be sent (VAPID keys + a database of subscriptions). */
export function pushAvailable() {
  return (
    has("DATABASE_URL") &&
    has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") &&
    has("VAPID_PRIVATE_KEY") &&
    has("VAPID_SUBJECT")
  );
}

/** QStash can call us back (token, signing keys and a public https URL). */
export function schedulingAvailable() {
  if (
    !pushAvailable() ||
    !has("QSTASH_TOKEN") ||
    !has("QSTASH_CURRENT_SIGNING_KEY") ||
    !has("QSTASH_NEXT_SIGNING_KEY") ||
    !has("APP_URL")
  )
    return false;
  try {
    return new URL(process.env.APP_URL!).protocol === "https:";
  } catch {
    return false;
  }
}

/** The exact URLs QStash publishes to (and signs). */
export function deliverUrl() {
  return new URL("/api/push/deliver", process.env.APP_URL!).toString();
}
export function disruptionsUrl() {
  return new URL("/api/push/disruptions", process.env.APP_URL!).toString();
}
