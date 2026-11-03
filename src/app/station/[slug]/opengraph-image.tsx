import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE } from "@/lib/og";
import { getStation, LINES, PLATFORMS } from "@/lib/network";

export const alt = "MRT Time station board";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const station = getStation(slug);
  return new ImageResponse(
    <OgCard
      title={station ? `${station.name.en} MRT` : "MRT Time"}
      subtitle="Next trains per direction, with confidence"
      chips={(station?.codes ?? []).map((c) => ({ label: c, color: LINES[PLATFORMS[c].line].color }))}
    />,
    size,
  );
}
