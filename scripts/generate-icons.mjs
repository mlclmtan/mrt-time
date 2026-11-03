// Renders the PWA icons from one SVG (sharp comes with Next).
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const nextRequire = createRequire(import.meta.resolve("next"));
const sharp = nextRequire("sharp");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="115" fill="#0b0d10"/><rect x="96" y="128" width="320" height="200" rx="28" fill="#15191e" stroke="#2b3138" stroke-width="8"/><text x="256" y="262" font-family="Helvetica, Arial, sans-serif" font-size="120" font-weight="700" fill="#f6c343" text-anchor="middle">3</text><text x="256" y="306" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="600" fill="#f6c343" text-anchor="middle">min</text><rect x="96" y="360" width="104" height="24" rx="12" fill="#009645"/><rect x="204" y="360" width="104" height="24" rx="12" fill="#9D5B25"/><rect x="312" y="360" width="104" height="24" rx="12" fill="#9900AA"/></svg>`;
await mkdir("public/icons", { recursive: true });
for (const size of [180, 192, 512])
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
await sharp(Buffer.from(svg.replace('rx="115"', 'rx="0"'))).resize(512, 512).png().toFile("public/icons/maskable-512.png");
await writeFile("public/icons/source.svg", svg);
