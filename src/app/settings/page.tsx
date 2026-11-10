import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/server";
import { pushAvailable } from "@/lib/push/config";
import { ConsentSettings } from "@/components/analytics/consent-banner";
import { VersionFooter } from "@/components/version-footer";
import { LanguageSwitch } from "@/components/language-switch";
import { OwnerSettings } from "@/components/owner/owner-settings";
import { FeedbackLink } from "@/components/voc/feedback-widget";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const [{ t }, session] = await Promise.all([getT(), getSession()]);
  return (
    <div className="max-w-xl space-y-5 pt-6">
      <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
      <VersionFooter className="-mt-3" />
      <section className="panel space-y-3 p-4">
        <h2 className="font-semibold">{t("settings.consent")}</h2>
        <ConsentSettings />
      </section>
      <section className="panel flex items-center justify-between p-4">
        <h2 className="font-semibold">{t("lang.label")}</h2>
        <LanguageSwitch />
      </section>
      <section className="panel flex items-center justify-between p-4">
        <h2 className="font-semibold">{t("feedback.title")}</h2>
        <FeedbackLink className="btn btn-secondary px-3 py-1.5 text-sm" />
      </section>
      <section id="install" className="panel scroll-mt-24 space-y-1 p-4">
        <h2 className="font-semibold">{t("settings.install")}</h2>
        <p className="text-sm text-muted">{t("settings.installIos")}</p>
      </section>
      {session?.user && <OwnerSettings isOwner={session.user.role === "owner"} pushReady={pushAvailable()} vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />}
    </div>
  );
}
