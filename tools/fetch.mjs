// Download the raw inputs into data/raw/ (not stored in git):
//   OpenStreetMap extracts from Overpass, and the NRCan HRDEM 2 m terrain model.
// Usage: deno run -A tools/fetch.mjs        (or: node tools/fetch.mjs)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'raw');
mkdirSync(OUT, { recursive: true });

const API = 'https://overpass-api.de/api/interpreter';
const UA = 'utsc-digital-twin/1.0 (https://github.com/FelixJiashengFu/utsc-digital-twin)';
const B = '43.7725,-79.2010,43.7975,-79.1720'; // south, west, north, east

const queries = {
  buildings: `( way["building"](${B}); relation["building"](${B});
    way["building:part"](${B}); relation["building:part"](${B}); ); out body geom;`,
  landscape: `( way["highway"](${B}); way["leisure"](${B}); relation["leisure"](${B});
    way["landuse"](${B}); relation["landuse"](${B}); way["natural"](${B}); relation["natural"](${B});
    way["amenity"="parking"](${B}); way["waterway"](${B}); way["man_made"](${B}); way["railway"](${B}); ); out body geom;`,
  campus: `( relation(21058560); ); out body geom;`,
  nodes: `( node["natural"="tree"](${B}); node["highway"="bus_stop"](${B}); node["public_transport"](${B});
    node["amenity"](${B}); node["entrance"](${B}); node["tourism"](${B}); node["historic"](${B}); ); out body;`,
};

async function overpass(name, q) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(`[out:json][timeout:150];${q}`),
    });
    if (res.ok) {
      const text = await res.text();
      writeFileSync(join(OUT, `${name}.json`), text);
      console.log(`${name}.json  ${(text.length / 1024).toFixed(0)} KB`);
      return;
    }
    console.log(`${name}: HTTP ${res.status}, retrying in ${attempt * 20}s`);
    await new Promise((r) => setTimeout(r, attempt * 20000));
  }
  throw new Error(`Overpass query ${name} failed`);
}

for (const [name, q] of Object.entries(queries)) await overpass(name, q);

// NRCan High Resolution Digital Elevation Model (HRDEM) mosaic, bare-earth DTM, via WCS,
// resampled by the server to a 2 m grid in Web Mercator (EPSG:3857) over the same box.
const R = 20037508.342789244;
const mx = (lon) => (lon * R) / 180;
const my = (lat) => (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * R) / Math.PI;
const [s, w, n, e] = B.split(',').map(Number);
const bbox = [Math.floor(mx(w)), Math.floor(my(s)), Math.ceil(mx(e)), Math.ceil(my(n))].join(',');
const wcs = 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic?service=WCS&version=1.1.1' +
  `&request=GetCoverage&identifier=dtm&BoundingBox=${bbox},urn:ogc:def:crs:EPSG::3857` +
  '&GridBaseCRS=urn:ogc:def:crs:EPSG::3857&GridOffsets=2,-2&format=image/geotiff';
const res = await fetch(wcs, { headers: { 'User-Agent': UA } });
if (!res.ok) throw new Error(`HRDEM WCS: HTTP ${res.status}`);
const tif = new Uint8Array(await res.arrayBuffer());
writeFileSync(join(OUT, 'dtm_3857.tif'), tif);
console.log(`dtm_3857.tif  ${(tif.length / 1048576).toFixed(1)} MB`);
