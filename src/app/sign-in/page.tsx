import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { SignInButtons } from "@/components/auth/sign-in-buttons";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SignInPage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-sm space-y-5 pt-10">
      <h1 className="text-3xl font-bold">{t("signIn.title")}</h1>
      <p className="text-sm text-muted">{t("signIn.only")}</p>
      <SignInButtons />
    </div>
  );
}
