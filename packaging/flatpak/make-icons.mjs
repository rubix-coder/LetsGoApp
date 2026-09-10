/* Resize the webapp launcher icon into the hicolor sizes the Flatpak needs.
   Uses `sharp` from webapp/node_modules (a webapp devDependency) — no extra
   install. Source: webapp/assets/icon-only.png (the maskable/full-bleed mark).

   Usage: node packaging/flatpak/make-icons.mjs <out-dir>
   Writes <out-dir>/16.png .. <out-dir>/512.png  */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const require = createRequire(join(repoRoot, "webapp", "package.json"));
const sharp = require("sharp");

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node make-icons.mjs <out-dir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const src = join(repoRoot, "webapp", "assets", "icon-only.png");
const sizes = [16, 32, 48, 64, 128, 256, 512];

await Promise.all(
  sizes.map((px) =>
    sharp(src)
      .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(outDir, `${px}.png`)),
  ),
);
console.log(`icons: ${sizes.join(", ")} → ${outDir}`);
