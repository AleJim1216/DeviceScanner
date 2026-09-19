export function assignedGroupId(shot) {
  if (shot == null) {
    return null;
  }
  const value = shot.groupId ?? shot.group_id;
  if (value == null || value === "") {
    return null;
  }
  return value;
}

export function unassignedCount(shots) {
  return (shots || []).filter((shot) => assignedGroupId(shot) == null).length;
}

export function allAssigned(shots) {
  return Boolean(shots?.length) && unassignedCount(shots) === 0;
}

export function nextSetNumber(shots) {
  const used = new Set();
  for (const shot of shots || []) {
    const value = Number(assignedGroupId(shot));
    if (Number.isInteger(value) && value >= 1) {
      used.add(value);
    }
  }
  let number = 1;
  while (used.has(number)) {
    number += 1;
  }
  return number;
}

export function assignSet(shots, indexes, setNumber) {
  const chosen = new Set(indexes);
  return (shots || []).map((shot, index) => (chosen.has(index) ? { ...shot, groupId: setNumber } : shot));
}

export function unassignShot(shots, index) {
  return (shots || []).map((shot, item) => (item === index ? { ...shot, groupId: null } : shot));
}

export function badgeLabel(groupId) {
  if (groupId == null || groupId === "") {
    return "";
  }
  const number = Number(groupId);
  if (!Number.isInteger(number) || number < 1) {
    return "";
  }
  return String(number);
}

export function setColor(groupId, colors) {
  const palette = colors?.length ? colors : ["#1aa6a0"];
  const number = Number(groupId);
  if (!Number.isInteger(number) || number < 1) {
    return palette[0];
  }
  return palette[(number - 1) % palette.length];
}

export function canOpenGrouping(shots) {
  return (shots || []).some((shot) => shot.source === "library" || assignedGroupId(shot) == null);
}

export function canOpenPhotos(shots) {
  return Boolean(shots?.length);
}

export function assignedShots(shots) {
  return (shots || []).filter((shot) => assignedGroupId(shot) != null);
}

export function shotsInSet(shots, setNumber) {
  const number = Number(setNumber);
  return (shots || []).filter((shot) => Number(assignedGroupId(shot)) === number);
}

export function scopedShots(shots, scope) {
  if (scope?.type === "session") {
    return shotsInSet(shots, scope.setNumber);
  }
  return assignedShots(shots);
}

export function canAnalyze(shots) {
  return assignedShots(shots).length > 0;
}

export function usedSetNumbers(shots) {
  const seen = [];
  for (const shot of shots || []) {
    const value = Number(assignedGroupId(shot));
    if (Number.isInteger(value) && value >= 1 && !seen.includes(value)) {
      seen.push(value);
    }
  }
  return seen.sort((left, right) => left - right);
}

export function filterItems(sets, includeUnassigned = false) {
  return [
    { id: "all", label: "All" },
    ...(includeUnassigned ? [{ id: "none", label: "Unassigned" }] : []),
    ...(sets || []).map((number) => ({ id: number, label: `Set ${number}` })),
  ];
}

export function filterLabel(filter, sets, includeUnassigned = false) {
  return filterItems(sets, includeUnassigned).find((item) => String(item.id) === String(filter))?.label || "All";
}

export function storageFilter(value) {
  if (value == null || value === "all") {
    return "all";
  }
  if (value === "none") {
    return "none";
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : "all";
}

export function visibleIndexes(shots, filter) {
  return (shots || []).reduce((list, shot, index) => {
    if (filter === "all") {
      list.push(index);
    } else if (filter === "none" && assignedGroupId(shot) == null) {
      list.push(index);
    } else if (filter !== "all" && filter !== "none" && Number(assignedGroupId(shot)) === Number(filter)) {
      list.push(index);
    }
    return list;
  }, []);
}

export function createSetNumber(shots, indexes) {
  const groups = [];
  for (const index of indexes || []) {
    const value = assignedGroupId((shots || [])[index]);
    if (value != null && !groups.includes(value)) {
      groups.push(value);
    }
  }
  if (groups.length === 1) {
    return groups[0];
  }
  return nextSetNumber(shots);
}

export function removeFromSets(shots, indexes) {
  const chosen = new Set(indexes);
  return (shots || []).map((shot, index) => (chosen.has(index) ? { ...shot, groupId: null } : shot));
}

export function canAddToSet(selectedCount, sets) {
  return Number(selectedCount) > 0 && Boolean((sets || []).length);
}

export function addToSetLabel(sets, selectedCount, open = false) {
  if (!canAddToSet(selectedCount, sets)) {
    return "Add to set";
  }
  if ((sets || []).length === 1) {
    return `Add to Set ${sets[0]}`;
  }
  return open ? "Add to set ▴" : "Add to set ▾";
}

export function nextScreen(shots, trigger) {
  if (trigger === "library") {
    return "Photos";
  }
  return "Camera";
}

export function payloadGroupId(shot) {
  const value = assignedGroupId(shot);
  return value == null ? null : String(value);
}

export function unassignedCopy(count) {
  if (count <= 0) {
    return "All photos are in a set";
  }
  if (count === 1) {
    return "1 photo not in a set";
  }
  return `${count} photos not in a set`;
}
