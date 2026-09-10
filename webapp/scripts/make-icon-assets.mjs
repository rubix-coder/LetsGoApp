/* THE SOURCE OF TRUTH for the LetsGo app icon.

   Everything in webapp/assets/ is generated from the vector definition below,
   reproducibly — re-running this writes byte-identical PNGs. Edit the gradient
   or the chevron paths here, never the PNGs.

     node webapp/scripts/make-icon-assets.mjs webapp/assets
     (or: pnpm --filter letsgo-webapp icons)

   icon-only.png is the one that ships: packaging/flatpak/make-icons.mjs
   resizes it into the hicolor set the Flatpak installs. The adaptive-icon and
   splash outputs are shaped for a mobile shell, which this repo does not
   currently build — they are kept as brand masters.

   public/icon.svg draws its chevrons with <text> in JetBrains Mono — no
   rasterizer here has that font, so the glyphs are redrawn as paths with the
   same geometry (two ▸ triangles, optically centered). */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const GRAD = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#8b6cf7"/><stop offset="1" stop-color="#6b4ce0"/>
</linearGradient></defs>`;
// Two ▸ chevrons, spanning x 30..64 in a 96 viewBox, vertically centered at 48.
const CHEVRONS = (fill) =>
  `<path fill="${fill}" d="M30 35 L46 48 L30 61 Z"/><path fill="${fill}" d="M48 35 L64 48 L48 61 Z"/>`;

const svg = (body, size = 96) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`;

const render = (name, body, px, size = 96) =>
  sharp(Buffer.from(svg(body, size)), { density: (72 * px) / size })
    .resize(px, px)
    .png()
    .toFile(`${OUT}/${name}`);

await Promise.all([
  // Full icon (legacy launchers): gradient rounded square + chevrons.
  render("icon-only.png", `${GRAD}<rect width="96" height="96" rx="26" fill="url(#g)"/>${CHEVRONS("#ffffff")}`, 1024),
  // Adaptive icon: full-bleed gradient background…
  render("icon-background.png", `${GRAD}<rect width="96" height="96" fill="url(#g)"/>`, 1024),
  // …and chevrons shrunk into the 66% safe zone on a transparent foreground.
  render(
    "icon-foreground.png",
    `<g transform="translate(48 48) scale(0.6) translate(-48 -48)">${CHEVRONS("#ffffff")}</g>`,
    1024,
  ),
  // Splash: theme ground colors with the full icon mark centered.
  render(
    "splash.png",
    `<rect width="96" height="96" fill="#eeeef3"/>${GRAD}<g transform="translate(48 48) scale(0.18) translate(-48 -48)"><rect width="96" height="96" rx="26" fill="url(#g)"/>${CHEVRONS("#ffffff")}</g>`,
    2732,
  ),
  render(
    "splash-dark.png",
    `<rect width="96" height="96" fill="#0b0d16"/>${GRAD}<g transform="translate(48 48) scale(0.18) translate(-48 -48)"><rect width="96" height="96" rx="26" fill="url(#g)"/>${CHEVRONS("#ffffff")}</g>`,
    2732,
  ),
]);
console.log("assets rendered to", OUT);
