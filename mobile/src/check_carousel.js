const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs
  .readFileSync(path.join(__dirname, "carouselLayout.js"), "utf8")
  .replace(/^export const (\w+) = /gm, "const $1 = ")
  .replace(/^export function (\w+)/gm, "function $1")
  .concat(
      "\nexports.PEEK = PEEK; exports.RING_PEEK = RING_PEEK; exports.FALLBACK_ASPECT = FALLBACK_ASPECT;" +
      "\nexports.SIDE_SCALE = SIDE_SCALE; exports.SIDE_GAP = SIDE_GAP; exports.HOLD_MS = HOLD_MS;" +
      "\nexports.aspectFromSize = aspectFromSize; exports.fitSize = fitSize;" +
      "\nexports.rollerFrame = rollerFrame; exports.visualOffset = visualOffset;" +
      "\nexports.rollerVisible = rollerVisible; exports.rollerClear = rollerClear;" +
      "\nexports.nearestCenter = nearestCenter; exports.settleTarget = settleTarget;" +
      "\nexports.ringSpacing = ringSpacing; exports.ringPose = ringPose;" +
      "\nexports.framesSeparate = framesSeparate; exports.pointInFrame = pointInFrame;" +
      "\nexports.ringZ = ringZ; exports.ringSlots = ringSlots; exports.wrapIndex = wrapIndex;" +
      "\nexports.splitSpin = splitSpin;" +
      "\nexports.assignUploadViews = assignUploadViews;" +
      "\nexports.gridCellSize = gridCellSize;"
  );
const exported = {};
vm.runInNewContext(source, { exports: exported, module: { exports: exported } });
const {
  FALLBACK_ASPECT,
  HOLD_MS,
  SIDE_GAP,
  SIDE_SCALE,
  aspectFromSize,
  assignUploadViews,
  gridCellSize,
  fitSize,
  framesSeparate,
  nearestCenter,
  pointInFrame,
  ringPose,
  ringSlots,
  ringSpacing,
  ringZ,
  rollerClear,
  rollerFrame,
  settleTarget,
  splitSpin,
  visualOffset,
  wrapIndex,
} = exported;

const stageW = 390;
const maxH = Math.round(844 * 0.46);
const phone = fitSize(3 / 4, stageW, maxH);
const frame = rollerFrame(stageW, 500);
const width = frame.width;

assert.equal(FALLBACK_ASPECT, 3 / 4);
assert.ok(Math.abs(phone.width / phone.height - 0.75) < 0.02);
assert.equal(aspectFromSize(3024, 4032), 3024 / 4032);
assert.equal(HOLD_MS, 1000);
assert.ok(Math.abs(frame.width / frame.height - FALLBACK_ASPECT) < 0.02);
assert.equal(JSON.stringify(rollerFrame(390, 500)), JSON.stringify(fitSize(3 / 4, 390, 500)));
assert.equal(JSON.stringify(rollerFrame(390, 500)), JSON.stringify(rollerFrame(390, 500)));

const center = ringPose(0, width);
const left = ringPose(-1, width);
const right = ringPose(1, width);
assert.equal(center.x, 0);
assert.equal(center.scale, 1);
assert.equal(left.x, -ringSpacing(width));
assert.equal(right.x, ringSpacing(width));
assert.ok(left.scale < 0.8 && right.scale < 0.8);
assert.ok(center.scale <= 1 && left.scale <= 1 && right.scale <= 1);
assert.ok(framesSeparate(width, center.x, center.scale, width, left.x, left.scale));
assert.ok(framesSeparate(width, center.x, center.scale, width, right.x, right.scale));

assert.ok(Math.abs(visualOffset(0, 0.3, 3) + 0.3) < 1e-9);
assert.ok(Math.abs(visualOffset(1, 0.3, 3) - 0.7) < 1e-9);
assert.equal(nearestCenter(2.6, 3), 0);
assert.equal(nearestCenter(0.4, 3), 0);
assert.equal(settleTarget(1.2, 0), 1);
assert.equal(settleTarget(1.2, -0.6), 2);
assert.equal(settleTarget(1.8, 0.6), 1);

for (let step = -20; step <= 40; step += 1) {
  const t = step / 10;
  assert.ok(rollerClear(t, 3, width), `overlap at ${t} count=3`);
  assert.ok(rollerClear(t, 2, width), `overlap at ${t} count=2`);
  assert.ok(rollerClear(t, 4, width), `overlap at ${t} count=4`);
}

assert.equal(splitSpin(1.3).steps, 1);
assert.ok(Math.abs(splitSpin(1.3).fraction - 0.3) < 1e-9);
assert.equal(splitSpin(-1.3).steps, -1);
assert.ok(Math.abs(splitSpin(-1.3).fraction + 0.3) < 1e-9);
assert.equal(splitSpin(0.4).steps, 0);
assert.equal(wrapIndex(0, splitSpin(2.1).steps, 3), 2);
assert.equal(left.opacity, undefined);
assert.ok(ringZ(0, 0) > ringZ(-1, 0));
assert.ok(ringZ(1, 1) > ringZ(0, 1));
assert.equal(wrapIndex(2, 1, 3), 0);
assert.equal(wrapIndex(0, -1, 3), 2);
assert.equal(wrapIndex(0, 1, 3), 1);
assert.deepEqual([...ringSlots(3)].map(Number), [-1, 0, 1]);
assert.equal(wrapIndex(0, -1, 3), 2);

assert.equal(
  JSON.stringify(assignUploadViews("front", 3, ["front", "rear_ports", "label"])),
  JSON.stringify(["front", "front", "front"])
);
assert.equal(JSON.stringify(gridCellSize(390)), JSON.stringify({ cellW: 175, cellH: 233, gap: 8, pad: 16 }));
assert.ok(Math.abs(gridCellSize(390).cellW / gridCellSize(390).cellH - FALLBACK_ASPECT) < 0.02);

assert.equal(ringPose(1, width).x, ringPose(0, width).x + ringSpacing(width));
assert.equal(ringPose(0, width).scale, 1);
assert.ok(ringSpacing(width) >= (width * (1 + SIDE_SCALE)) / 2 + SIDE_GAP - 1);
assert.ok(pointInFrame(150, 200, { x: 100, y: 150, w: 200, h: 100 }));
assert.ok(!pointInFrame(20, 200, { x: 100, y: 150, w: 200, h: 100 }));

console.log("carousel layout ok", { phone, frame, center, left, right, spacing: ringSpacing(width) });
