import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE } from "@/lib/og";

export const alt = "MRT Time — next-train times for Singapore MRT";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <OgCard
      title="Know your next train before the platform"
      subtitle="Live boards · door-to-door planner · honest confidence"
      chips={[
        { label: "EWL", color: "#009645" },
        { label: "TEL", color: "#9D5B25" },
        { label: "NEL", color: "#9900AA" },
      ]}
    />,
    size,
  );
}
