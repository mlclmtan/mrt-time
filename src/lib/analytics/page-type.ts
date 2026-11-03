import type { PAGE_TYPES } from "./events";

type PageType = (typeof PAGE_TYPES)[number];

/** Page type for page_view from a locale-stripped path. */
export function pageTypeFor(path: string, userType: string = "visitor"): PageType {
  if (path === "/" || path === "") return userType === "owner" ? "owner_home" : "landing";
  const first = path.split("/")[1];
  const map: Record<string, PageType> = {
    station: "station",
    plan: "planner",
    accuracy: "accuracy",
    "media-kit": "media_kit",
    about: "about",
    privacy: "privacy",
    terms: "terms",
    submit: "submit",
    settings: "settings",
    admin: "admin",
    k: "kol",
    "sign-in": "sign_in",
    me: "owner_home",
  };
  return map[first] ?? "other";
}
