const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const grouping = fs
  .readFileSync(path.join(__dirname, "grouping.js"), "utf8")
  .replace(/^export function (\w+)/gm, "function $1");
const session = fs
  .readFileSync(path.join(__dirname, "cameraSession.js"), "utf8")
  .replace(/^import .+$/m, "")
  .replace(/^export function (\w+)/gm, "function $1")
  .concat(
    "\nexports.cameraSetNumber = cameraSetNumber;" +
      "\nexports.currentCameraSet = currentCameraSet;" +
      "\nexports.clearCameraSession = clearCameraSession;"
  );
const exported = {};
vm.runInNewContext(grouping + "\n" + session, { exports: exported, module: { exports: exported } });
const { cameraSetNumber, currentCameraSet, clearCameraSession } = exported;

clearCameraSession();
assert.equal(currentCameraSet(), null);
const first = cameraSetNumber([{ groupId: 1 }, { groupId: null }]);
assert.equal(first, 2);
assert.equal(cameraSetNumber([{ groupId: 1 }]), 2);
assert.equal(currentCameraSet(), 2);
clearCameraSession();
assert.equal(currentCameraSet(), null);
assert.equal(cameraSetNumber([]), 1);
clearCameraSession();
console.log("camera session ok");
