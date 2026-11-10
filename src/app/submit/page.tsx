import { permanentRedirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";

/** The old "Add a reading" (now "Log a train") address; the rebuilt flow lives at /add. */
export default async function SubmitPage() {
  const { locale } = await getT();
  permanentRedirect(localePath(locale, "/add"));
}
