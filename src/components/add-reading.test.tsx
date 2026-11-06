import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { directionChoices, searchStations } from "@/lib/network";
import { AddReading } from "./add-reading";
import { QuickEntry } from "./board/quick-entry";

const JARGON = /headway|source|status|observation|direction key|dest code|TO_EAST|TO_WEST|TO_NORTH|TO_BAYSHORE/i;
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("Add a reading (/add)", () => {
  it("shows the station, big buttons named like the board, and minute chips on one screen", () => {
    const html = renderToStaticMarkup(<AddReading defaultStation="EW17" defaultDirection="TO_EAST" />);
    expect(html).toContain("Tiong Bahru");
    expect(html).toContain("Pasir Ris");
    expect(html).toContain("Joo Koon / Tuas Link");
    expect(html).toContain("Board says:");
    expect(html).toContain("next train to Pasir Ris in");
    for (const n of [0, 7, 15]) expect(html).toMatch(new RegExp(`>${n}</button>`));
    expect(html).toContain("seen at");
    expect(visibleText(html)).not.toMatch(JARGON);
  });

  it("groups early-ending trains under the direction (Springleaf → Woodlands North)", () => {
    const tel = directionChoices("outram-park").filter((c) => c.line === "TEL");
    expect(tel.map((c) => c.board.en)).toEqual(["Bayshore", "Woodlands North"]);
    expect(tel[1].alsoBoard.map((b) => b.en)).toEqual(["Springleaf"]);
    const html = renderToStaticMarkup(<AddReading defaultStation="TE17" defaultDirection="TO_NORTH" />);
    expect(html).toContain("Woodlands North");
    expect(html).toContain("incl. trains ending at Springleaf");
    expect(html).toContain("Bayshore");
    expect(visibleText(html)).not.toMatch(JARGON);
  });

  it("without a default it starts with a searchable list (English and 中文)", () => {
    const html = renderToStaticMarkup(<AddReading />);
    expect(html).toContain("Search a station");
    expect(html).toContain("中峇魯");
    expect(searchStations("中峇").map((s) => s.slug)).toEqual(["tiong-bahru"]);
    expect(searchStations("outram").map((s) => s.slug)).toEqual(["outram-park"]);
    expect(searchStations("EW17").map((s) => s.slug)).toEqual(["tiong-bahru"]);
  });

  it("the inline station-page entry reads like the platform board, with no jargon", () => {
    const html = renderToStaticMarkup(<QuickEntry station="EW17" line="EWL" direction="TO_EAST" destination="Pasir Ris" />);
    expect(visibleText(html).replace(/\s+/g, " ")).toMatch(/Board says: next train to Pasir Ris in – min, then – min/);
    expect(visibleText(html)).not.toMatch(JARGON);
  });
});
