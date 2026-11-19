import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLocale } from "@/lib/i18n/server";
import { htmlLang, makeT } from "@/lib/i18n";
import { getSession } from "@/lib/auth/server";
import { experimentAssignments } from "@/lib/server/experiments";
import { appUrl, siteVerification } from "@/lib/seo";
import { I18nProvider } from "@/components/i18n";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { ConsentBanner } from "@/components/analytics/consent-banner";
import { PwaRegistration } from "@/components/pwa-registration";
import { SiteHeader, SiteFooter, AppMain } from "@/components/shell";
import { TabBar } from "@/components/tab-bar";
import { FeedbackWidget } from "@/components/voc/feedback-widget";
import { NpsPrompt } from "@/components/voc/nps-prompt";
import { InstallPrompt } from "@/components/install-prompt";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = makeT(locale);
  return {
    metadataBase: new URL(appUrl()),
    title: { default: `${t("app.name")} — ${t("app.tagline")}`, template: `%s · ${t("app.name")}` },
    description: t("hero.sub"),
    applicationName: "MRT Time",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MRT Time" },
    icons: {
      icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
    },
    formatDetection: { telephone: false },
    verification: siteVerification(),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07090b",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, session, experiments] = await Promise.all([getLocale(), getSession(), experimentAssignments()]);
  const userType = session?.user.role ?? "visitor";
  return (
    <html lang={htmlLang(locale)}>
      <body data-clarity-mask="True">
        <I18nProvider locale={locale}>
          <AnalyticsProvider locale={locale} userType={userType} experiments={experiments}>
            <PwaRegistration />
            <div className="relative mx-auto flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden">
              <SiteHeader signedIn={!!session} />
              <AppMain>
                <div className="flex-1">{children}</div>
                <SiteFooter />
              </AppMain>
              <ConsentBanner />
              <TabBar role={session?.user.role ?? null} />
            </div>
            <InstallPrompt />
            <FeedbackWidget />
            <NpsPrompt />
          </AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
