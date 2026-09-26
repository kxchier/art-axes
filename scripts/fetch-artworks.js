const fs = require("node:fs/promises");
const path = require("node:path");

const API = "https://api.artic.edu/api/v1/artworks/search";
const queries = ["painting", "sculpture", "photograph", "photography", "textile", "ceramic", "print", "drawing", "decorative arts", "furniture"];
const fields = [
  "id", "title", "artist_title", "date_display", "date_start", "date_end",
  "place_of_origin", "medium_display", "classification_title", "image_id",
  "is_public_domain"
].join(",");

function classify(work) {
  const text = `${work.classification_title || ""} ${work.medium_display || ""}`.toLowerCase();
  if (/photograph|daguerreotype|negative/.test(text)) return "photography";
  if (/textile|weaving|tapestry|costume|fabric|cloth/.test(text)) return "textile";
  if (/sculpture|statue|statuette|relief/.test(text)) return "sculpture";
  if (/painting|oil on|tempera/.test(text)) return "painting";
  if (/print|drawing|etching|lithograph|woodblock|engraving|watercolor|gouache/.test(text)) return "paper";
  if (work._query === "sculpture") return "sculpture";
  if (["photograph", "photography"].includes(work._query)) return "photography";
  if (work._query === "textile") return "textile";
  if (work._query === "painting") return "painting";
  if (["print", "drawing"].includes(work._query)) return "paper";
  return "object";
}

function era(year) {
  if (!Number.isFinite(year)) return "unknown";
  if (year < 1500) return "ancient";
  if (year < 1800) return "pre1800";
  if (year < 1900) return "1800s";
  return "modern";
}

async function fetchQuery(query) {
  const url = new URL(API);
  url.searchParams.set("q", query);
  url.searchParams.set("query[term][is_public_domain]", "true");
  url.searchParams.set("limit", "80");
  url.searchParams.set("fields", fields);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${query}: ${response.status}`);
  return (await response.json()).data.map(work => ({ ...work, _query: query }));
}

function variedSample(items, limit) {
  const eraOrder = ["ancient", "pre1800", "1800s", "modern", "unknown"];
  const buckets = new Map(eraOrder.map(key => [key, []]));
  items.forEach(item => buckets.get(item.era).push(item));
  const chosen = [];
  while (chosen.length < limit) {
    let added = false;
    for (const key of eraOrder) {
      const item = buckets.get(key).shift();
      if (item) {
        chosen.push(item);
        added = true;
        if (chosen.length === limit) break;
      }
    }
    if (!added) break;
  }
  return chosen;
}

async function main() {
  const batches = [];
  for (const query of queries) {
    console.log(`fetching ${query}`);
    batches.push(...await fetchQuery(query));
  }

  const unique = new Map();
  for (const work of batches) {
    if (!work.image_id || !work.is_public_domain || unique.has(work.id)) continue;
    const year = Number.isFinite(work.date_start) ? work.date_start : null;
    const kind = classify(work);
    unique.set(work.id, {
      id: work.id,
      title: work.title || "Untitled",
      artist: work.artist_title || "Unknown artist",
      date: work.date_display || "Date unknown",
      year,
      era: era(year),
      origin: work.place_of_origin || "Origin unknown",
      medium: work.medium_display || "Medium unknown",
      classification: work.classification_title || "Artwork",
      image: work.image_id,
      kind,
      source: `https://www.artic.edu/artworks/${work.id}`
    });
  }

  const kinds = ["painting", "paper", "sculpture", "object", "textile", "photography"];
  const selected = kinds.flatMap(kind => variedSample([...unique.values()].filter(work => work.kind === kind), 24));
  selected.sort((a, b) => a.kind.localeCompare(b.kind) || (a.year ?? 9999) - (b.year ?? 9999) || a.id - b.id);

  const output = `window.ARTWORKS = ${JSON.stringify(selected, null, 2)};\n`;
  await fs.writeFile(path.resolve(__dirname, "../dist/artworks.js"), output);
  const counts = Object.fromEntries(kinds.map(kind => [kind, selected.filter(work => work.kind === kind).length]));
  console.log(`saved ${selected.length} public-domain works`, counts);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
