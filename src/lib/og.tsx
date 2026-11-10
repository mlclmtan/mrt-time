/** Shared OG card (English only: the bundled OG font has no CJK glyphs). */
import { BrandMark } from "@/components/brand-mark";
export const OG_SIZE = { width: 1200, height: 630 };

export function OgCard({ title, subtitle, chips }: { title: string; subtitle: string; chips: { label: string; color: string }[] }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#07090b", color: "#eef1f3", padding: 64, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Static brand mark (no number: a minutes badge read like a countdown). */}
        <BrandMark size={56} />
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>MRT Time</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", gap: 12 }}>
          {chips.map((c) => (
            <div key={c.label} style={{ display: "flex", background: c.color, color: "white", borderRadius: 999, padding: "6px 18px", fontSize: 28, fontWeight: 700 }}>
              {c.label}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 32, color: "#8b949e" }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", fontSize: 26, color: "#f6c343" }}>Next-train times from real platform boards</div>
    </div>
  );
}
