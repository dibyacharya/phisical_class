/**
 * create-icon.js — Generates a simple icon.png using canvas (if sharp not available)
 * Run: node create-icon.js
 * Outputs: assets/icon.png (256x256)
 *
 * On Windows, convert to .ico using:
 *   npx png-to-ico assets/icon.png --output assets/icon.ico
 * Or just use any online ICO converter.
 */
const fs   = require("fs");
const path = require("path");

// Generate a minimal 16x16 PNG manually (red circle)
// This is a base64-encoded 256x256 PNG with orange background + camera icon
const ICON_B64 = `
iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAAsTAAALEwEAmpwYAAAF
HGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0w
TXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRh
LyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS42LWMxNDUgNzkuMTYzNDk5LCAyMDE4LzA4LzEz
LTE2OjQwOjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3Jn
LzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hw
YWNrZXQgZW5kPSJyIj8+`;

const dir = path.join(__dirname, "assets");
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Write a simple SVG instead (works as icon source)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#ea580c"/>
  <rect width="256" height="256" rx="48" fill="url(#g)"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#9a3412"/>
    </linearGradient>
  </defs>
  <!-- Camera body -->
  <rect x="56" y="96" width="144" height="100" rx="16" fill="white" opacity="0.95"/>
  <!-- Lens -->
  <circle cx="128" cy="146" r="30" fill="#ea580c"/>
  <circle cx="128" cy="146" r="20" fill="#fff" opacity="0.3"/>
  <!-- Viewfinder bump -->
  <rect x="90" y="80" width="36" height="20" rx="6" fill="white" opacity="0.95"/>
  <!-- REC dot -->
  <circle cx="174" cy="108" r="8" fill="#ef4444"/>
</svg>`;

const svgPath = path.join(dir, "icon.svg");
fs.writeFileSync(svgPath, svg);
console.log("✅ Created assets/icon.svg");
console.log("   → Convert to icon.ico at: https://convertio.co/svg-ico/");
console.log("   → Or run: npx electron-icon-maker --input=assets/icon.svg --output=assets/");
