import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "assets";

const svgLogo = (w, h, text) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="rgb(20,30,80)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${Math.floor(h*0.55)}"
        font-weight="700" fill="white">${text}</text>
</svg>`);

const svgIcon = (size) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="rgb(20,30,80)" rx="${size*0.18}"/>
  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${Math.floor(size*0.55)}"
        font-weight="700" fill="white">RP</text>
</svg>`);

async function emit(buf, name) {
  await writeFile(`${OUT}/${name}`, buf);
  console.log(`wrote ${OUT}/${name}`);
}

await mkdir(OUT, { recursive: true });
await emit(await sharp(svgIcon(29)).png().toBuffer(), "icon.png");
await emit(await sharp(svgIcon(58)).png().toBuffer(), "icon@2x.png");
await emit(await sharp(svgIcon(87)).png().toBuffer(), "icon@3x.png");
await emit(await sharp(svgLogo(160, 50, "Rocket Partners")).png().toBuffer(), "logo.png");
await emit(await sharp(svgLogo(320, 100, "Rocket Partners")).png().toBuffer(), "logo@2x.png");
console.log("✓ placeholder assets generated");
