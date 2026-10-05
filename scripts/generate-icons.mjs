// Draws the SKTR Coach app icon and writes every size the site uses.
// Run: node scripts/generate-icons.mjs
// The mark: three white track lanes sweeping round a bend, with a yellow dot, on the brand blue. Change it here, run the script, commit the files it writes.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const BLUE = "#2152ff"
const YELLOW = "#ffc93c"
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")

/**
 * The mark on a 512 canvas: three lanes sweeping round the bottom-left corner, and the dot.
 * `safe` pulls the dot in so it survives the circle crop on maskable icons.
 */
function mark(safe = false) {
  const lanes = [420, 330, 240].map((r) => `<circle cx="0" cy="512" r="${r}" fill="none" stroke="#ffffff" stroke-width="46"/>`).join("")
  const dot = safe ? `<circle cx="350" cy="162" r="40" fill="${YELLOW}"/>` : `<circle cx="372" cy="140" r="44" fill="${YELLOW}"/>`
  return lanes + dot
}

/** rounded: a tile with round corners on a clear background. Otherwise the blue fills the whole square. */
function icon({ rounded, safe = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><clipPath id="tile"><rect width="512" height="512" ${rounded ? 'rx="116"' : ""}/></clipPath></defs>
  <g clip-path="url(#tile)"><rect width="512" height="512" fill="${BLUE}"/>${mark(safe)}</g>
</svg>
`
}

const roundedSvg = icon({ rounded: true })
const fullSvg = icon({ rounded: false })
const maskableSvg = icon({ rounded: false, safe: true })

async function png(svg, size, file) {
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(path.join(publicDir, file))
}

await mkdir(path.join(publicDir, "icons"), { recursive: true })
await writeFile(path.join(publicDir, "favicon.svg"), roundedSvg)
await writeFile(path.join(publicDir, "icons", "icon.svg"), roundedSvg)
await png(roundedSvg, 32, "favicon-32.png")
await png(roundedSvg, 16, "favicon-16.png")
await png(roundedSvg, 192, "icons/icon-192.png")
await png(roundedSvg, 512, "icons/icon-512.png")
await png(maskableSvg, 512, "icons/icon-maskable-512.png")
// iOS adds its own corner rounding and does not like clear pixels, so this one is a full square.
await png(fullSvg, 180, "apple-touch-icon.png")
// Older links and saved shortcuts still ask for this file.
await png(roundedSvg, 512, "app-icon.png")
console.log("Icons written to public/")
