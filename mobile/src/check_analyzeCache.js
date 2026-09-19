const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const groupingSource = fs
  .readFileSync(path.join(__dirname, "grouping.js"), "utf8")
  .replace(/^export function (\w+)/gm, "function $1");
const cacheSource = fs
  .readFileSync(path.join(__dirname, "analyzeCache.js"), "utf8")
  .replace(/^import .+$/m, "")
  .replace(/^export function (\w+)/gm, "function $1")
  .concat(
    "\nexports.cacheKey = cacheKey;" +
      "\nexports.clearAnalyzeCache = clearAnalyzeCache;" +
      "\nexports.forgetShots = forgetShots;" +
      "\nexports.cachedPhotoFor = cachedPhotoFor;" +
      "\nexports.rememberAnalyzed = rememberAnalyzed;" +
      "\nexports.applyShotGroup = applyShotGroup;" +
      "\nexports.missingViews = missingViews;" +
      "\nexports.buildAnalyzeGroups = buildAnalyzeGroups;" +
      "\nexports.analyzeResult = analyzeResult;" +
      "\nexports.partitionShots = partitionShots;" +
      "\nexports.shouldSendAll = shouldSendAll;" +
      "\nexports.pendingPhotos = pendingPhotos;" +
      "\nexports.photoForShot = photoForShot;" +
      "\nexports.resultFromCache = resultFromCache;" +
      "\nexports.displayPhotos = displayPhotos;" +
      "\nexports.mergeAnalyzed = mergeAnalyzed;" +
      "\nexports.cacheEntries = cacheEntries;" +
      "\nexports.restoreCache = restoreCache;"
  );
const exported = {};
vm.runInNewContext(`${groupingSource}\n${cacheSource}`, { exports: exported, module: { exports: exported } });
const {
  applyShotGroup,
  analyzeResult,
  cachedPhotoFor,
  clearAnalyzeCache,
  forgetShots,
  cacheEntries,
  mergeAnalyzed,
  missingViews,
  partitionShots,
  restoreCache,
  rememberAnalyzed,
  resultFromCache,
  displayPhotos,
  pendingPhotos,
  photoForShot,
  shouldSendAll,
} = exported;

clearAnalyzeCache();
assert.equal(JSON.stringify(missingViews(["front"])), JSON.stringify(["rear_ports", "label"]));
assert.equal(analyzeResult([{ group_id: "2", intended_view: "front", view_uncertain: false }]).groups[0].label, "Set 2");
assert.equal(
  JSON.stringify(analyzeResult([{ group_id: "DEV-001", intended_view: "label", view_uncertain: false }]).groups[0].missing_views),
  JSON.stringify(["front", "rear_ports"])
);

const first = { id: "shot-a", uri: "file:///a.jpg", groupId: 1 };
const second = { id: "shot-b", uri: "file:///b.jpg", groupId: 1 };
rememberAnalyzed(
  [first],
  [{ image_id: "upload-1", intended_view: "front", status: "usable", group_id: "1", view_uncertain: false }]
);
assert.equal(cachedPhotoFor(first).intended_view, "front");
assert.equal(cachedPhotoFor({ ...first, uri: "file:///changed.jpg" }), null);
assert.equal(applyShotGroup(cachedPhotoFor(first), { ...first, groupId: 3 }).group_id, "3");

const split = partitionShots([first, second]);
assert.equal(split.cached.length, 1);
assert.equal(split.fresh.length, 1);
assert.equal(shouldSendAll([first, second], split.fresh), false);
assert.equal(shouldSendAll([{ ...first, groupId: null }, second], split.fresh), true);
assert.equal(resultFromCache([first, second]), null);
assert.equal(resultFromCache([first]).photos[0].status, "usable");
assert.equal(pendingPhotos([second])[0].status, "");
assert.equal(displayPhotos([first, second], null)[0].status, "usable");
assert.equal(displayPhotos([first, second], null)[1].status, "");
assert.equal(photoForShot(first).intended_view, "front");

const next = [first, { ...second, groupId: 2 }];
const nextSplit = partitionShots(next);
const merged = mergeAnalyzed(
  next,
  nextSplit.cached,
  nextSplit.fresh,
  [{ image_id: "upload-2", intended_view: "label", status: "retake", group_id: "2", view_uncertain: false }]
);
assert.equal(JSON.stringify(merged.photos.map((photo) => photo.intended_view)), JSON.stringify(["front", "label"]));
assert.equal(JSON.stringify(merged.groups.map((group) => group.group_id)), JSON.stringify(["1", "2"]));
assert.equal(JSON.stringify(merged.groups[1].missing_views), JSON.stringify(["front", "rear_ports"]));

const stale = {
  photos: [
    { image_id: "upload-1", intended_view: "front", status: "usable", group_id: "1", view_uncertain: false },
    { image_id: "upload-2", intended_view: "label", status: "retake", group_id: "2", view_uncertain: false },
  ],
};
const swapped = displayPhotos([next[1], next[0]], stale);
assert.equal(swapped[0].intended_view, "label");
assert.equal(swapped[0].status, "retake");
assert.equal(swapped[1].intended_view, "front");
assert.equal(swapped[1].status, "usable");
const extra = { id: "shot-c", uri: "file:///c.jpg", groupId: 3 };
assert.equal(displayPhotos([next[1], extra], stale)[1].status, "");

const stored = cacheEntries();
clearAnalyzeCache();
assert.equal(cachedPhotoFor(first), null);
restoreCache(stored);
assert.equal(cachedPhotoFor(first).status, "usable");
restoreCache([]);
assert.equal(cachedPhotoFor(first).status, "usable");
forgetShots([first]);
assert.equal(cachedPhotoFor(first), null);
assert.equal(cachedPhotoFor(second).intended_view, "label");
clearAnalyzeCache();
assert.equal(partitionShots([second]).fresh.length, 1);

console.log("analyze cache ok");
