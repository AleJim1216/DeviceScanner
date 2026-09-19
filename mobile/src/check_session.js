const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs
  .readFileSync(path.join(__dirname, "sessionShots.js"), "utf8")
  .replace(/^export function (\w+)/gm, "function $1")
  .replace(/^let current = \[\];/m, "let current = [];")
  .concat("\nexports.rememberShots = rememberShots;\nexports.sessionShots = sessionShots;");
const exported = {};
vm.runInNewContext(source, { exports: exported, module: { exports: exported } });
const { rememberShots, sessionShots } = exported;

assert.equal(JSON.stringify(sessionShots()), "[]");
const first = [{ uri: "a", groupId: null }];
assert.strictEqual(rememberShots(first), first);
assert.equal(JSON.stringify(sessionShots()), JSON.stringify(first));
rememberShots([{ uri: "b", groupId: 1 }]);
assert.equal(sessionShots()[0].groupId, 1);
rememberShots([]);
assert.equal(JSON.stringify(sessionShots()), "[]");
rememberShots();
assert.equal(JSON.stringify(sessionShots()), "[]");
console.log("session shots ok");
