#!/usr/bin/env node
// Generates the Open Graph images in public/ with sharp. Run: node scripts/og.mjs
//   public/og.png        1200x630, brand gradient, logo and strapline (site-wide default)
//   public/og-event.jpg  1200x630, AMYBO photo behind the 13 November 2026 event title
//   public/logo.png      512x512, the AMYBO mark on white, for the Organization structured data
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const FONT = 'Arial, Helvetica, sans-serif';
// Inline the logo as a nested <svg> (librsvg does not load data: images), scaled from its 7087x4905 px canvas.
const logoAt = (x, y, w, h) =>
	readFileSync('src/assets/amybo_dark.svg', 'utf8')
		.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '')
		.replace(/<svg width="7087px" height="4905px"/, `<svg viewBox="0 0 7087 4905" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"`);

async function write(file, svg, background) {
	const overlay = Buffer.from(svg);
	const image = background
		? sharp(background).resize(1200, 630, { fit: 'cover' }).composite([{ input: overlay }])
		: sharp(overlay);
	const out = await (file.endsWith('.jpg') ? image.jpeg({ quality: 82, mozjpeg: true }) : image.png({ compressionLevel: 9 })).toBuffer();
	writeFileSync(file, out);
	console.log(`${file} ${out.length} bytes`);
}

await write('public/logo.png', `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="#ffffff"/>
  ${readFileSync('src/assets/amybo.svg', 'utf8').replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '').replace(/<svg width="7087px" height="4905px"/, '<svg viewBox="0 0 7087 4905" x="40" y="88" width="432" height="336" preserveAspectRatio="xMidYMid meet"')}
</svg>`);

await write('public/og.png', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b2e14"/><stop offset="1" stop-color="#175a00"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  ${logoAt(90, 120, 420, 290)}
  <text x="540" y="250" font-family="${FONT}" font-size="52" font-weight="700" fill="#ffffff">Sustainable protein</text>
  <text x="540" y="322" font-family="${FONT}" font-size="52" font-weight="700" fill="#87BD25">for all</text>
  <text x="540" y="400" font-family="${FONT}" font-size="28" fill="#dfe9d6">Open source protein fermentation</text>
  <text x="540" y="442" font-family="${FONT}" font-size="28" fill="#dfe9d6">amybo.org</text>
</svg>`);

// Photo: anode of an Aseptic electroPioreactor 0.1 after a run (AMYBO, CC BY-SA 4.0), darkened so the title reads.
await write('public/og-event.jpg', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05140a" stop-opacity="0.55"/><stop offset="1" stop-color="#05140a" stop-opacity="0.92"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#d)"/>
  ${logoAt(80, 60, 190, 130)}
  <text x="80" y="330" font-family="${FONT}" font-size="60" font-weight="700" fill="#ffffff">AMYBO get-together</text>
  <text x="80" y="410" font-family="${FONT}" font-size="44" font-weight="700" fill="#87BD25">London, Friday 13 November 2026</text>
  <text x="80" y="480" font-family="${FONT}" font-size="28" fill="#dfe9d6">Lab tours, talks and discussion at Imperial College White City. Free.</text>
  <text x="80" y="540" font-family="${FONT}" font-size="28" fill="#dfe9d6">amybo.org/events</text>
</svg>`, 'src/assets/photos/aep01-anode-discolouration.jpg');
