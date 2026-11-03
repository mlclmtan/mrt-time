import Script from "next/script";
import { thirdPartyScripts, type TagIds } from "@/lib/analytics/scripts";
import type { Consent } from "@/lib/analytics/consent";

/**
 * Renders third-party tags for the granted consent only. With consent
 * denied (or undecided) this renders nothing at all.
 */
export function ThirdPartyScripts({
  consent,
  ids,
  internal = false,
}: {
  consent: Pick<Consent, "analytics" | "marketing">;
  ids: TagIds;
  internal?: boolean;
}) {
  const scripts = thirdPartyScripts(consent, ids, { internal });
  if (!scripts.length) return null;
  return (
    <>
      {scripts.map((s) =>
        s.src ? (
          <Script key={s.id} id={s.id} src={s.src} strategy="afterInteractive" />
        ) : (
          <Script key={s.id} id={s.id} strategy="afterInteractive">
            {s.inline}
          </Script>
        ),
      )}
    </>
  );
}
