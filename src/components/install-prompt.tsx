"use client";
import { useEffect, useState } from "react";
import { useAnalytics } from "./analytics/analytics-provider";
import { useI18n } from "./i18n";
import { isStandalone } from "@/lib/analytics/client";

type BeforeInstall = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Android/desktop install prompt (beforeinstallprompt); iOS gets a hint in Settings. */
export function InstallPrompt() {
  const { t } = useI18n();
  const { track } = useAnalytics();
  const [evt, setEvt] = useState<BeforeInstall | null>(null);
  useEffect(() => {
    if (isStandalone() || localStorage.getItem("mrt_install_dismissed")) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstall);
      track("install_prompt_shown", { platform: /android/i.test(navigator.userAgent) ? "android" : "desktop" });
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [track]);
  if (!evt) return null;
  return (
    <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-40 px-3">
      <div className="panel rise mx-auto flex max-w-md items-center gap-3 p-3 text-sm">
        <span className="flex-1">{t("install.prompt")}</span>
        <button
          type="button"
          className="btn btn-primary py-2"
          onClick={async () => {
            await evt.prompt();
            setEvt(null);
          }}
        >
          {t("install.cta")}
        </button>
        <button
          type="button"
          className="text-muted"
          onClick={() => {
            localStorage.setItem("mrt_install_dismissed", "1");
            setEvt(null);
          }}
        >
          {t("install.dismiss")}
        </button>
      </div>
    </div>
  );
}
