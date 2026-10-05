// Draws the SKTR Coach app icon and writes every size the site uses.
// Run: node scripts/generate-icons.mjs
// The mark: a white "S" drawn as one lane of a running track, with a yellow dot at its head,
// on the brand blue. Change it here, run the script, commit the files it writes.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const BLUE = "#2152ff"
const YELLOW = "#ffc93c"
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")

/** The mark on a 512 canvas. `scale` shrinks it about the centre (maskable icons need a safe margin). */
function mark(scale = 1) {
  return `<g transform="translate(256 256) scale(${scale}) translate(-268 -256)">
    <path d="M330 139 A80 80 0 1 0 256 256 A80 80 0 1 1 182 373" fill="none" stroke="#ffffff" stroke-width="68" stroke-linecap="round"/>
    <circle cx="386" cy="212" r="33" fill="${YELLOW}"/>
  </g>`
}

/** rounded: a tile with round corners on a clear background. Otherwise the blue fills the whole square. */
function icon({ rounded, scale = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" ${rounded ? 'rx="116"' : ""} fill="${BLUE}"/>
  ${mark(scale)}
</svg>
`
}

const roundedSvg = icon({ rounded: true })
const fullSvg = icon({ rounded: false })
const maskableSvg = icon({ rounded: false, scale: 0.74 })

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
