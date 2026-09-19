import * as FileSystem from "expo-file-system/legacy";
import { cacheEntries, clearAnalyzeCache, forgetShots, restoreCache } from "./analyzeCache";
import { clearCameraSession } from "./cameraSession";
import { analyzeCachePath, shotIndexPath, shotStoreDir, storedShotUri } from "./photoPaths";
import { rememberShots, sessionShots } from "./sessionShots";

export { analyzeCachePath, shotIndexPath, shotStoreDir, storedShotUri };

let afterPersist = null;

export function setAfterPersist(fn) {
  afterPersist = fn;
}

function documentRoot() {
  return FileSystem.documentDirectory || "";
}

export async function persistShots(shots, options = {}) {
  rememberShots(shots);
  const root = documentRoot();
  if (root) {
    try {
      await FileSystem.makeDirectoryAsync(shotStoreDir(root), { intermediates: true });
      await FileSystem.writeAsStringAsync(shotIndexPath(root), JSON.stringify(shots || []));
      await persistAnalyzeCache();
    } catch {
      // Memory still holds the session if disk is unavailable.
    }
  }
  if (!options.skipSync) {
    try {
      afterPersist?.(shots || []);
    } catch {
      // Sync is best-effort.
    }
  }
  return shots || [];
}

export async function persistAnalyzeCache(root = documentRoot()) {
  if (!root) {
    return;
  }
  try {
    await FileSystem.makeDirectoryAsync(shotStoreDir(root), { intermediates: true });
    await FileSystem.writeAsStringAsync(analyzeCachePath(root), JSON.stringify(cacheEntries()));
  } catch {
    // Analysis can stay in memory if the cache file cannot be written.
  }
}

export async function loadAnalyzeCache(root = documentRoot()) {
  if (!root) {
    return;
  }
  try {
    const path = analyzeCachePath(root);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      return;
    }
    const rows = JSON.parse(await FileSystem.readAsStringAsync(path));
    if (Array.isArray(rows)) {
      restoreCache(rows);
    }
  } catch {
    // Keep whatever is already in memory.
  }
}

export async function loadPersistedShots() {
  const root = documentRoot();
  if (!root) {
    return sessionShots();
  }
  try {
    const index = shotIndexPath(root);
    const info = await FileSystem.getInfoAsync(index);
    if (!info.exists) {
      return sessionShots();
    }
    const rows = JSON.parse(await FileSystem.readAsStringAsync(index));
    if (Array.isArray(rows)) {
      rememberShots(rows);
    }
    await loadAnalyzeCache(root);
  } catch {
    // Keep whatever is already in memory.
  }
  return sessionShots();
}

export async function ingestShot(shot, root = documentRoot()) {
  const id = shot.id || `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!root || !shot.uri) {
    return { ...shot, id };
  }
  const dest = storedShotUri(root, id);
  try {
    await FileSystem.makeDirectoryAsync(shotStoreDir(root), { intermediates: true });
    if (shot.uri !== dest) {
      await FileSystem.copyAsync({ from: shot.uri, to: dest });
    }
    return { ...shot, id, uri: dest };
  } catch {
    return { ...shot, id };
  }
}

export async function appendCaptured(existing, added) {
  const stored = [];
  for (const shot of added || []) {
    stored.push(await ingestShot(shot));
  }
  const next = [...(existing || []), ...stored];
  await persistShots(next);
  return next;
}

export async function deletePersisted(shots, indexes) {
  const drop = new Set(indexes);
  const root = documentRoot();
  const dir = root ? shotStoreDir(root) : "";
  const next = [];
  for (let index = 0; index < (shots || []).length; index += 1) {
    const shot = shots[index];
    if (drop.has(index)) {
      forgetShots([shot]);
      if (dir && shot.uri && String(shot.uri).startsWith(dir)) {
        try {
          await FileSystem.deleteAsync(shot.uri, { idempotent: true });
        } catch {
          // Index update still drops the row.
        }
      }
      continue;
    }
    next.push(shot);
  }
  await persistShots(next);
  return next;
}

export async function clearPersisted() {
  rememberShots([]);
  clearAnalyzeCache();
  clearCameraSession();
  const root = documentRoot();
  if (!root) {
    return;
  }
  try {
    await FileSystem.deleteAsync(shotStoreDir(root), { idempotent: true });
  } catch {
    // Memory is already empty.
  }
}
