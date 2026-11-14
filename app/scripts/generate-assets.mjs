// Generates the iOS app icon and launch (splash) images from the site's own
// Bebas Neue wordmark, so the app matches obey.tools exactly.
//
//   npm run assets
//
// Writes straight into the Xcode asset catalog. Output is opaque RGB PNG:
// App Store Connect rejects app icons that contain an alpha channel.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('playwright-core')) }

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONT = path.resolve(APP, '../assets/fonts/bebas-neue-latin.woff2')
const XC = path.join(APP, 'ios/App/App/Assets.xcassets')
const BG = '#f8f8f8'
const fontData = fs.readFileSync(FONT).toString('base64')

const page = (size, text, fontPx, letter) => `<!doctype html><html><head><style>
@font-face { font-family: Bebas; src: url(data:font/woff2;base64,${fontData}) format('woff2'); }
html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${BG}; }
body { display: grid; place-items: center; }
span { font: ${fontPx}px/1 Bebas; letter-spacing: ${letter}px; color: #000; transform: translateY(${Math.round(fontPx * 0.04)}px); }
</style></head><body><span>${text}</span></body></html>`

async function render(browser, size, text, fontPx, letter) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await p.setContent(page(size, text, fontPx, letter))
  await p.evaluate(() => document.fonts.ready)
  const png = await p.screenshot({ type: 'png' })
  await p.close()
  return sharp(png).flatten({ background: BG }).removeAlpha().png({ compressionLevel: 9 })
}

const browser = await chromium.launch()
try {
  // App icon: 1024 single-size (Xcode 14+ derives every other size).
  const icon = path.join(XC, 'AppIcon.appiconset')
  for (const f of fs.readdirSync(icon)) if (f.endsWith('.png')) fs.rmSync(path.join(icon, f))
  await (await render(browser, 1024, 'OBEY.', 440, 4)).toFile(path.join(icon, 'AppIcon-1024.png'))
  fs.writeFileSync(path.join(icon, 'Contents.json'), JSON.stringify({
    images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  }, null, 2) + '\n')

  // Launch image: centred wordmark, sized to survive aspect-fill cropping on phones.
  const splash = path.join(XC, 'Splash.imageset')
  const img = await render(browser, 2732, 'OBEY.TOOLS', 260, 4)
  const buf = await img.toBuffer()
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) fs.writeFileSync(path.join(splash, f), buf)

  console.log('[assets] wrote AppIcon-1024.png and launch images')
} finally {
  await browser.close()
}
