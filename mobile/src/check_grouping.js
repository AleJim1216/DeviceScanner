const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs
  .readFileSync(path.join(__dirname, "grouping.js"), "utf8")
  .replace(/^export function (\w+)/gm, "function $1")
  .concat(
    "\nexports.assignedGroupId = assignedGroupId;" +
      "\nexports.unassignedCount = unassignedCount;" +
      "\nexports.allAssigned = allAssigned;" +
      "\nexports.nextSetNumber = nextSetNumber;" +
      "\nexports.assignSet = assignSet;" +
      "\nexports.unassignShot = unassignShot;" +
      "\nexports.badgeLabel = badgeLabel;" +
      "\nexports.setColor = setColor;" +
      "\nexports.unassignedCopy = unassignedCopy;" +
      "\nexports.nextScreen = nextScreen;" +
      "\nexports.canOpenGrouping = canOpenGrouping;" +
      "\nexports.canOpenPhotos = canOpenPhotos;" +
      "\nexports.canAnalyze = canAnalyze;" +
      "\nexports.usedSetNumbers = usedSetNumbers;" +
      "\nexports.visibleIndexes = visibleIndexes;" +
      "\nexports.removeFromSets = removeFromSets;" +
      "\nexports.createSetNumber = createSetNumber;" +
      "\nexports.payloadGroupId = payloadGroupId;" +
      "\nexports.filterItems = filterItems;" +
      "\nexports.filterLabel = filterLabel;" +
      "\nexports.storageFilter = storageFilter;" +
      "\nexports.storageFilterFromShot = storageFilterFromShot;" +
      "\nexports.canAddToSet = canAddToSet;" +
      "\nexports.addToSetLabel = addToSetLabel;" +
      "\nexports.assignedShots = assignedShots;" +
      "\nexports.shotsInSet = shotsInSet;" +
      "\nexports.scopedShots = scopedShots;"
  );
const exported = {};
vm.runInNewContext(source, { exports: exported, module: { exports: exported } });
const {
  assignedGroupId,
  allAssigned,
  assignSet,
  badgeLabel,
  nextSetNumber,
  setColor,
  unassignShot,
  unassignedCopy,
  unassignedCount,
  nextScreen,
  canOpenGrouping,
  canOpenPhotos,
  canAnalyze,
  usedSetNumbers,
  visibleIndexes,
  removeFromSets,
  createSetNumber,
  payloadGroupId,
  filterItems,
  filterLabel,
  storageFilter,
  storageFilterFromShot,
  canAddToSet,
  addToSetLabel,
  assignedShots,
  shotsInSet,
  scopedShots,
} = exported;

const colors = ["#1aa6a0", "#c46b2d", "#2b5f9e"];
const empty = [{ uri: "a", groupId: null }, { uri: "b" }, { uri: "c", groupId: "" }];
assert.equal(unassignedCount(empty), 3);
assert.equal(allAssigned(empty), false);
assert.equal(allAssigned([]), false);
assert.equal(nextSetNumber(empty), 1);
assert.equal(assignedGroupId({ groupId: 2 }), 2);
assert.equal(assignedGroupId({ groupId: null }), null);

const afterFirst = assignSet(empty, [0, 2], nextSetNumber(empty));
assert.deepEqual(
  afterFirst.map((shot) => assignedGroupId(shot)),
  [1, null, 1]
);
assert.equal(unassignedCount(afterFirst), 1);
assert.equal(nextSetNumber(afterFirst), 2);
assert.equal(allAssigned(afterFirst), false);

const afterSecond = assignSet(afterFirst, [1], nextSetNumber(afterFirst));
assert.deepEqual(
  afterSecond.map((shot) => assignedGroupId(shot)),
  [1, 2, 1]
);
assert.equal(allAssigned(afterSecond), true);
assert.equal(nextSetNumber(afterSecond), 3);

const reused = assignSet(unassignShot(afterSecond, 1), [1], nextSetNumber(unassignShot(afterSecond, 1)));
assert.deepEqual(
  reused.map((shot) => assignedGroupId(shot)),
  [1, 2, 1]
);

const gapped = [{ groupId: 1 }, { groupId: 3 }, { groupId: null }];
assert.equal(nextSetNumber(gapped), 2);

assert.equal(badgeLabel(1), "1");
assert.equal(badgeLabel("2"), "2");
assert.equal(badgeLabel("DEV-001"), "");
assert.equal(badgeLabel(null), "");
assert.equal(setColor(1, colors), "#1aa6a0");
assert.equal(setColor(2, colors), "#c46b2d");
assert.equal(setColor(4, colors), "#1aa6a0");
assert.equal(unassignedCopy(0), "All photos are in a set");
assert.equal(unassignedCopy(1), "1 photo not in a set");
assert.equal(unassignedCopy(3), "3 photos not in a set");

assert.equal(nextScreen([{ groupId: 1 }], "camera"), "Camera");
assert.equal(nextScreen([{ groupId: 1 }, { groupId: null }], "camera"), "Camera");
assert.equal(nextScreen([{ groupId: 1 }], "library"), "Photos");
assert.equal(nextScreen([], "library"), "Photos");
assert.equal(canOpenGrouping([{ source: "camera", groupId: 1 }]), false);
assert.equal(canOpenGrouping([{ source: "library", groupId: 1 }]), true);
assert.equal(canOpenGrouping([{ source: "camera", groupId: 1 }, { source: "library", groupId: null }]), true);
assert.equal(canOpenGrouping([]), false);
assert.equal(allAssigned([{ groupId: 1 }, { groupId: 2 }]), true);
assert.equal(allAssigned([{ groupId: 1 }, { groupId: null }]), false);

const batch = Array.from({ length: 8 }, (_, index) => ({ uri: `u${index}`, source: "library", groupId: null }));
assert.equal(nextScreen(batch, "library"), "Photos");
assert.equal(allAssigned(batch), false);
const setOne = assignSet(batch, [0, 1, 2], nextSetNumber(batch));
assert.equal(nextSetNumber(setOne), 2);
assert.equal(unassignedCount(setOne), 5);
const setTwo = assignSet(setOne, [3, 4, 5, 6, 7], nextSetNumber(setOne));
assert.deepEqual(
  setTwo.map((shot) => assignedGroupId(shot)),
  [1, 1, 1, 2, 2, 2, 2, 2]
);
assert.equal(allAssigned(setTwo), true);
assert.equal(canOpenGrouping(setTwo), true);
assert.equal(nextScreen([{ source: "camera", groupId: 1 }], "camera"), "Camera");
assert.equal(payloadGroupId({ groupId: 1 }), "1");
assert.equal(payloadGroupId({ groupId: "2" }), "2");
assert.equal(payloadGroupId({ groupId: null }), null);
assert.equal(payloadGroupId({}), null);
assert.equal(canOpenPhotos([]), false);
assert.equal(canOpenPhotos([{ uri: "a" }]), true);
assert.equal(canAnalyze([{ groupId: 1 }]), true);
assert.equal(canAnalyze([{ groupId: null }]), false);
assert.equal(canAnalyze([{ groupId: 1 }, { groupId: null }]), true);
assert.deepEqual(
  assignedShots([{ groupId: 1 }, { groupId: null }, { groupId: 2 }]).map((shot) => shot.groupId),
  [1, 2]
);
assert.deepEqual(
  shotsInSet([{ groupId: 1 }, { groupId: 2 }, { groupId: 1 }], 1).map((shot) => shot.groupId),
  [1, 1]
);
assert.deepEqual(
  scopedShots([{ groupId: 1 }, { groupId: null }], { type: "storage" }).map((shot) => shot.groupId),
  [1]
);
assert.deepEqual(
  scopedShots([{ groupId: 1 }, { groupId: 2 }], { type: "session", setNumber: 2 }).map((shot) => shot.groupId),
  [2]
);
assert.deepEqual(
  scopedShots(
    [
      { id: "a", groupId: 1 },
      { id: "b", groupId: null },
    ],
    { type: "single", shotIds: ["b"] }
  ).map((shot) => shot.id),
  ["b"]
);
assert.deepEqual(scopedShots([{ id: "a", groupId: 1 }], { type: "single", shotIds: [] }), []);
assert.equal(JSON.stringify(usedSetNumbers([{ groupId: 2 }, { groupId: 1 }, { groupId: 2 }])), "[1,2]");
assert.equal(JSON.stringify(visibleIndexes([{ groupId: 1 }, { groupId: null }, { groupId: 2 }], "none")), "[1]");
assert.equal(JSON.stringify(visibleIndexes([{ groupId: 1 }, { groupId: null }, { groupId: 2 }], 2)), "[2]");
assert.deepEqual(
  removeFromSets([{ groupId: 1 }, { groupId: 2 }], [0]).map((shot) => assignedGroupId(shot)),
  [null, 2]
);
assert.equal(createSetNumber([{ groupId: null }, { groupId: null }], [0, 1]), 1);
assert.equal(createSetNumber([{ groupId: 2 }, { groupId: null }], [0, 1]), 2);
assert.equal(JSON.stringify(filterItems([2, 1], false).map((item) => item.id)), JSON.stringify(["all", 2, 1]));
assert.equal(JSON.stringify(filterItems([1], true).map((item) => item.id)), JSON.stringify(["all", "none", 1]));
assert.equal(filterLabel("all", [1], true), "All");
assert.equal(filterLabel("none", [1], true), "Unassigned");
assert.equal(filterLabel(2, [1, 2], false), "Set 2");
assert.equal(storageFilter(undefined), "all");
assert.equal(storageFilter("all"), "all");
assert.equal(storageFilter(2), 2);
assert.equal(storageFilter("2"), 2);
assert.equal(storageFilter("none"), "none");
assert.equal(storageFilter("DEV-001"), "all");
assert.equal(storageFilterFromShot({ groupId: 3 }), 3);
assert.equal(storageFilterFromShot({ group_id: 2 }), 2);
assert.equal(storageFilterFromShot({ groupId: null }), "none");
assert.equal(storageFilterFromShot(undefined), "none");
assert.equal(canAddToSet(0, [1]), false);
assert.equal(canAddToSet(1, []), false);
assert.equal(canAddToSet(1, [1]), true);
assert.equal(addToSetLabel([1], 0), "Add to set");
assert.equal(addToSetLabel([1], 2), "Add to Set 1");
assert.equal(addToSetLabel([1, 2], 1), "Add to set ▾");
assert.equal(addToSetLabel([1, 2], 1, true), "Add to set ▴");
assert.deepEqual(
  assignSet([{ groupId: 1 }, { groupId: null }], [1], 1).map((shot) => assignedGroupId(shot)),
  [1, 1]
);
assert.deepEqual(
  assignSet([{ groupId: 1 }, { groupId: 2 }], [0], 2).map((shot) => assignedGroupId(shot)),
  [2, 2]
);

console.log("grouping helpers ok");
