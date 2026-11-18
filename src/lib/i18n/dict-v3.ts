/**
 * v3 strings (bottom tab bar, trip screen, more navigation).
 * `v3Zh` must define every key.
 */
export const v3En = {
  "tab.trip": "Trip",
  "tab.stations": "Stations",
  "tab.log": "Log",
  "tab.plan": "Plan",
  "tab.me": "Me",
  "tab.more": "More",
  "more.title": "More",
} as const;

export const v3Zh: Record<keyof typeof v3En, string> = {
  "tab.trip": "行程",
  "tab.stations": "車站",
  "tab.log": "記錄",
  "tab.plan": "規劃",
  "tab.me": "我的",
  "tab.more": "更多",
  "more.title": "更多",
};
