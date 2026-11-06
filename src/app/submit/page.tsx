import { permanentRedirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";

/** The old "Add a reading" address; the rebuilt flow lives at /add. */
export default async function SubmitPage() {
  const { locale } = await getT();
  permanentRedirect(localePath(locale, "/add"));
}
