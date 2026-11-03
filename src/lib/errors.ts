/** Pure helpers that turn thrown things into words a person can act on. */
export const OFFLINE_MESSAGE =
  "You seem to be offline. Nothing was saved. Try again when you're back online.";
export const TIMEOUT_MESSAGE =
  "That took too long to hear back. It may not have saved, so refresh to check before trying again.";
export const GENERIC_MESSAGE = "Something went wrong. Please try again.";

const networkPatterns = [
  /failed to fetch/i,
  /load failed/i,
  /networkerror/i,
  /network request failed/i,
  /network connection was lost/i,
  /internet connection appears to be offline/i,
];

export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message, status } = error as {
    name?: string;
    message?: string;
    status?: number;
  };
  if (status === 0) return true;
  if (name === "TypeError" || name === "NetworkError" || name === undefined)
    return networkPatterns.some((pattern) => pattern.test(message || ""));
  return false;
}

export function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Fallback words for an HTTP failure without a server-provided message. */
export function httpErrorMessage(status: number): string {
  if (status === 401)
    return "Your sign-in has ended. Please refresh and sign in again.";
  if (status === 403) return "That isn't allowed from here. Please refresh.";
  if (status === 404) return "We couldn't find that any more. Please refresh.";
  if (status === 409)
    return "This changed somewhere else. Refresh and try again.";
  if (status === 429)
    return "Lots of taps at once! Wait a moment, then try again.";
  if (status >= 500)
    return "The server had a little hiccup. Nothing was changed, so please try again.";
  return GENERIC_MESSAGE;
}

/** One friendly sentence for any failure, preferring server-provided words. */
export function describeError(
  error: unknown,
  { online = true }: { online?: boolean } = {},
): string {
  // Timeouts first: the device can be online while the server is slow.
  if (isTimeoutError(error)) return TIMEOUT_MESSAGE;
  if (!online || isNetworkError(error)) return OFFLINE_MESSAGE;
  const message =
    typeof error === "string"
      ? error
      : (error as { message?: string } | null)?.message;
  return message?.trim() || GENERIC_MESSAGE;
}
