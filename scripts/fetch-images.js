const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

const datasetPath = path.resolve(__dirname, "../dist/artworks.js");
const imageDirectory = path.resolve(__dirname, "../dist/art");

async function main() {
  const source = await fs.readFile(datasetPath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const works = context.window.ARTWORKS;
  const unavailable = new Set();
  await fs.mkdir(imageDirectory, { recursive: true });

  for (let index = 0; index < works.length; index++) {
    const work = works[index];
    const destination = path.join(imageDirectory, `${work.id}.jpg`);
    try {
      await fs.access(destination);
      console.log(`${index + 1}/${works.length} cached ${work.id}`);
      continue;
    } catch {}

    const url = `https://www.artic.edu/iiif/2/${work.image}/full/480,/0/default.jpg`;
    const response = await fetch(url, { headers: { "User-Agent": "art-axes-research/1.0" } });
    if (!response.ok) {
      unavailable.add(work.id);
      console.warn(`${index + 1}/${works.length} skipped ${work.id} (${response.status})`);
      continue;
    }
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    console.log(`${index + 1}/${works.length} saved ${work.id}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (unavailable.size) {
    const availableWorks = works.filter(work => !unavailable.has(work.id));
    await fs.writeFile(datasetPath, `window.ARTWORKS = ${JSON.stringify(availableWorks, null, 2)};\n`);
    console.log(`removed ${unavailable.size} unavailable image record(s)`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
