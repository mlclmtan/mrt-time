/** Sticky experiment buckets from a per-browser seed cookie (server-assigned). */
export type Variant = { key: string; weight: number };
export type ExperimentDef = { key: string; variants: Variant[]; active: boolean };

export const BUCKET_COOKIE = "mrt_bucket";

/** The first experiment: landing hero headline + CTA. */
export const DEFAULT_EXPERIMENTS: ExperimentDef[] = [
  {
    key: "landing_hero",
    active: true,
    variants: [
      { key: "control", weight: 50 },
      { key: "countdown", weight: 50 },
    ],
  },
];

/** FNV-1a 32-bit. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function assignVariant(seed: string, exp: ExperimentDef): string | null {
  if (!exp.active || !exp.variants.length) return null;
  const total = exp.variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return exp.variants[0].key;
  const point = (fnv1a(`${exp.key}:${seed}`) / 0x100000000) * total;
  let acc = 0;
  for (const v of exp.variants) {
    acc += Math.max(0, v.weight);
    if (point < acc) return v.key;
  }
  return exp.variants[exp.variants.length - 1].key;
}

export function assignAll(seed: string, defs: ExperimentDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of defs) {
    const v = assignVariant(seed, def);
    if (v) out[def.key] = v;
  }
  return out;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function phi(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Two-proportion z-test; returns p-value and a plain note. */
export function significance(a: { n: number; x: number }, b: { n: number; x: number }) {
  if (a.n < 1 || b.n < 1) return { z: 0, p: 1, note: "Not enough data yet" };
  const pa = a.x / a.n;
  const pb = b.x / b.n;
  const pool = (a.x + b.x) / (a.n + b.n);
  const se = Math.sqrt(pool * (1 - pool) * (1 / a.n + 1 / b.n));
  if (!se) return { z: 0, p: 1, note: "No difference yet" };
  const z = (pb - pa) / se;
  const p = 2 * (1 - phi(Math.abs(z)));
  const note =
    a.n + b.n < 100
      ? "Too early: fewer than 100 exposed"
      : p < 0.05
        ? `Significant at 95% (p=${p.toFixed(3)})`
        : `Not significant (p=${p.toFixed(2)})`;
  return { z, p, note };
}
