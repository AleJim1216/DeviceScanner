const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs
  .readFileSync(path.join(__dirname, "photoPaths.js"), "utf8")
  .replace(/^export function (\w+)/gm, "function $1")
  .concat(
    "\nexports.shotStoreDir = shotStoreDir;" +
      "\nexports.shotIndexPath = shotIndexPath;" +
      "\nexports.storedShotUri = storedShotUri;" +
      "\nexports.analyzeCachePath = analyzeCachePath;" +
      "\nexports.profilePath = profilePath;"
  );
const exported = {};
vm.runInNewContext(source, { exports: exported, module: { exports: exported } });
const { shotStoreDir, shotIndexPath, storedShotUri, analyzeCachePath, profilePath } = exported;

assert.equal(shotStoreDir("file:///data/"), "file:///data/device-shots/");
assert.equal(shotIndexPath("file:///data/"), "file:///data/device-shots/index.json");
assert.equal(storedShotUri("file:///data/", "shot-1"), "file:///data/device-shots/shot-1.jpg");
assert.equal(analyzeCachePath("file:///data/"), "file:///data/device-shots/analyze.json");
assert.equal(profilePath("file:///data/"), "file:///data/device-profile.json");
console.log("photo store paths ok");
