import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getLocale } from "@/lib/i18n/server";
import { getAppRedirectTarget } from "@/lib/app-redirect";

export default async function AppPage() {
  const [session, locale] = await Promise.all([getSession(), getLocale()]);
  redirect(getAppRedirectTarget(session?.user.role ?? null, locale));
}
