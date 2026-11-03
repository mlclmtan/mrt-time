"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/server";
import { dbConfigured } from "@/lib/db";
import { legsSchema, ownerJourneys, updateJourneyLegs } from "@/lib/server/journeys";

/** Edit the fixed minutes of a saved journey's walk/transfer/ride legs. */
export async function saveLegMinutes(formData: FormData) {
  const session = await getSession();
  if (session?.user.role !== "owner" || !dbConfigured()) return;
  const key = String(formData.get("key") || "");
  const journey = (await ownerJourneys(session.user.id)).find((j) => j.key === key);
  if (!journey) return;
  const legs = journey.legs.map((leg, i) => {
    const value = Number(formData.get(`leg-${i}`));
    if (!Number.isFinite(value) || value < 0 || value > 120) return leg;
    return leg.kind === "ride" ? { ...leg, rideMin: value } : { ...leg, min: value };
  });
  const parsed = legsSchema.safeParse(legs);
  if (!parsed.success) return;
  await updateJourneyLegs(session.user.id, key, parsed.data);
  revalidatePath("/me");
}
