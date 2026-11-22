// Validate the files that are served to the map. No browser or image library required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const kit = new URL('../../kit/town/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('tileset-v1.json', kit), 'utf8'));
const scope = {};
runInNewContext(readFileSync(new URL('tileset-v1.js', kit), 'utf8'), scope);
assert.deepEqual(JSON.parse(JSON.stringify(scope.TownTileset)), manifest);
assert.equal(manifest.version, 1);
assert.equal(manifest.chip, 32);

const frames = new Map();
for (const atlas of Object.values(manifest.atlases)) {
  const png = readFileSync(new URL(atlas.file, kit));
  assert.equal(png.subarray(0, 16).toString('hex'), '89504e470d0a1a0a0000000d49484452');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [atlas.width, atlas.height]);
  assert.deepEqual([png[24], png[25]], [8, 6], atlas.file);
  for (const [key, rect] of Object.entries(atlas.frames)) {
    const [x, y, w, h] = rect;
    assert.ok(rect.every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0);
    assert.ok(x + w <= atlas.width && y + h <= atlas.height, key);
    assert.ok(!frames.has(key), key);
    frames.set(key, rect);
  }
}

const frame = (key, w, h) => {
  assert.ok(frames.has(key), String(key));
  if (w !== undefined) assert.deepEqual(frames.get(key).slice(2), [w, h], key);
};
const colors = (group) => manifest.colors[group].map(({ tones }) => tones[group === 'roof' ? 2 : 1]);
runInNewContext(readFileSync(new URL('../../public/town/town-gen.js', import.meta.url), 'utf8'), scope);
const T = scope.TownGen;
assert.deepEqual([...T.ROOF_COLORS].sort(), colors('roof').sort());
assert.deepEqual([...T.DOOR_COLORS].sort(), colors('door').sort());

for (const code of Object.values(T.GROUND)) {
  if (code === T.GROUND.canal || code === T.GROUND.bridge) continue;
  assert.ok(manifest.ground[code]?.length);
  for (const key of manifest.ground[code]) frame(key, 32, 32);
}
assert.equal(manifest.water.length, 16);
assert.equal(manifest.paths.length, 16);
for (const key of [...manifest.water.flat(), ...manifest.paths]) frame(key, 32, 32);
for (const code of Object.values(T.DECO).filter(Boolean)) {
  assert.ok(manifest.deco[code]?.length);
  for (const key of manifest.deco[code]) frame(key, 32, 32);
}
for (const [width, key] of Object.entries(manifest.bridges)) frame(key, Number(width) * 32, 128);
for (const key of Object.values(manifest.marks)) frame(key, 64, 64);
for (const [size, width] of [['S', 64], ['M', 128], ['L', 192]]) {
  frame('scaffold-' + size, width, width);
  for (const direction of ['north', 'south']) {
    const shop = manifest.shops[size + '-' + direction];
    frame(shop.base, width, width);
    assert.ok(shop.front >= 0 && shop.front < width);
    const counts = { roof: 5, door: 4, wall: 3, trim: 2 };
    for (const [group, count] of Object.entries(counts)) {
      assert.equal(shop.groups[group].length, count);
      for (const key of shop.groups[group]) frame(key, width, width);
    }
  }
}
assert.ok(manifest.shops['L-north'].rear > manifest.shops['L-north'].front);

for (const opts of [{}, { grow: 79 }, { grow: 79, avenue: 2, alley: 1, cols: 8, center: 'admin' }]) {
  const town = T.demoTown(opts);
  assert.equal(town.shops.size, 121 + (opts.grow ?? 0));
  for (const ch of T.chunksFor(town, town.districts)) {
    assert.equal(ch.tileset, 'kit/town/' + manifest.atlases.terrain.file);
    assert.equal(ch.tileset_manifest, 'kit/town/tileset-v1.json');
    for (const b of ch.bridges) frame(manifest.bridges[b.w], b.w * 32, b.h * 32);
    for (const o of ch.objects) {
      if (o.sub === 'stalls') {
        frame('stall-0', 64, 64);
      } else if (o.sub === 'pier' && o.w === 4) {
        frame('pier', 128, 128);
        frame('pier-north', 128, 128);
      } else if (o.kind === 'facility') {
        frame(o.sub === 'market' && o.w > 10 ? 'market-wide' : o.sub, o.w * 32, o.h * 32);
      } else if (o.kind === 'fountain') {
        frame('fountain', 128, 128);
      } else {
        frame(manifest.marks[o.sub], o.w * 32, o.h * 32);
      }
    }
  }
}
console.log('PNG atlas, placement manifest, color masks, and 121/200 shop asset coverage: ok');
