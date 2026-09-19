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
  .replace(/^export function (\w+)/gm, "function $1");
const syncSource = fs
  .readFileSync(path.join(__dirname, "dashboardSync.js"), "utf8")
  .replace(/^import .+$/gm, "")
  .replace(/^export function (\w+)/gm, "function $1")
  .replace(/^export async function (\w+)/gm, "async function $1")
  .replace(/setAfterPersist\([^)]+\);/, "")
  .concat("\nexports.snapshotRows = snapshotRows;");
const exported = {};
vm.runInNewContext(`${groupingSource}\n${cacheSource}\n${syncSource}`, {
  exports: exported,
  module: { exports: exported },
});
const { snapshotRows } = exported;

const shot = { id: "shot-a", uri: "file:///a.jpg", name: "a.jpg", view: "front", groupId: 2 };
const rows = snapshotRows([shot]);
assert.equal(rows[0].id, "shot-a");
assert.equal(rows[0].group_id, "2");
assert.equal(rows[0].view, "front");
assert.equal(rows[0].status, "");

const open = { id: "shot-b", uri: "file:///b.jpg", name: "b.jpg", view: "label", groupId: null };
assert.equal(snapshotRows([open])[0].group_id, null);
console.log("profile sync ok");
