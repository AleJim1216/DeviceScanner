import * as FileSystem from "expo-file-system/legacy";
import { applyShotGroup, cachedPhotoFor, pendingPhotos, rememberAnalyzed } from "./analyzeCache";
import { accountPhotoUrl, fetchSnapshot, packShot, pushSnapshot } from "./api";
import { payloadGroupId } from "./grouping";
import { ingestShot, loadPersistedShots, persistShots, setAfterPersist } from "./photoStore";
import { loadProfile } from "./profile";
import { sessionShots } from "./sessionShots";

let pushTimer = null;

export function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushLibraryNow().catch((err) => {
      console.log(`[check] snapshot failed: ${err?.message || "unreachable"}`);
    });
  }, 500);
}

setAfterPersist(schedulePush);

export function snapshotRows(shots) {
  return (shots || []).map((shot, index) => {
    const analyzed = cachedPhotoFor(shot);
    const base = analyzed ? applyShotGroup(analyzed, shot) : pendingPhotos([shot])[0];
    return {
      id: String(shot.id || `shot-${index + 1}`),
      name: shot.name || `${shot.id || `shot-${index + 1}`}.jpg`,
      view: shot.view || "front",
      intended_view: base.intended_view || shot.view || "front",
      status: base.status || "",
      issue_codes: base.issue_codes || [],
      reason: base.reason || "",
      guidance: base.guidance || "",
      view_uncertain: Boolean(base.view_uncertain),
      group_id: payloadGroupId(shot),
    };
  });
}

export async function buildSnapshot(shots) {
  const photos = [];
  for (let index = 0; index < (shots || []).length; index += 1) {
    const shot = shots[index];
    try {
      const packed = await packShot(shot, index);
      photos.push({
        ...snapshotRows([shot])[0],
        id: String(shot.id || `shot-${index + 1}`),
        image_base64: packed.image_base64,
      });
    } catch (err) {
      console.log(`[check] snapshot pack failed: ${err?.message || "unreachable"}`);
    }
  }
  if ((shots || []).length && !photos.length) {
    throw new Error("Could not pack photos for sync.");
  }
  return { photos };
}

function rememberRemote(shot, photo) {
  if (!photo?.status) {
    return;
  }
  rememberAnalyzed(
    [shot],
    [
      {
        image_id: photo.id,
        intended_view: photo.intended_view || shot.view || "front",
        status: photo.status,
        issue_codes: photo.issue_codes || [],
        reason: photo.reason || "",
        guidance: photo.guidance || "",
        view_uncertain: Boolean(photo.view_uncertain),
        group_id: photo.group_id == null ? "" : String(photo.group_id),
      },
    ]
  );
}

async function ingestRemote(photo, token) {
  const url = await accountPhotoUrl(photo.id, token);
  const root = FileSystem.documentDirectory || "";
  let uri = url;
  if (root) {
    const stored = await ingestShot({
      id: photo.id,
      uri: url,
      name: photo.name,
      view: photo.view || photo.intended_view || "front",
      source: "library",
      groupId: photo.group_id == null || photo.group_id === "" ? null : Number(photo.group_id) || photo.group_id,
    });
    if (stored.uri && stored.uri !== url) {
      return stored;
    }
    try {
      const dest = `${root}device-shots/${photo.id}.jpg`;
      await FileSystem.makeDirectoryAsync(`${root}device-shots/`, { intermediates: true });
      const downloaded = await FileSystem.downloadAsync(url, dest);
      uri = downloaded.uri || dest;
    } catch {
      uri = url;
    }
  }
  return {
    id: photo.id,
    uri,
    name: photo.name,
    view: photo.view || photo.intended_view || "front",
    source: "library",
    groupId: photo.group_id == null || photo.group_id === "" ? null : Number(photo.group_id) || photo.group_id,
  };
}

export async function mergeLibrary(local, remotePhotos, token) {
  const byId = new Map((local || []).map((shot) => [shot.id, shot]));
  const next = [];
  for (const photo of remotePhotos || []) {
    let shot = byId.get(photo.id);
    if (!shot) {
      shot = await ingestRemote(photo, token);
    } else {
      shot = {
        ...shot,
        groupId: photo.group_id == null || photo.group_id === "" ? null : Number(photo.group_id) || photo.group_id,
        view: photo.view || shot.view,
      };
    }
    next.push(shot);
    rememberRemote(shot, photo);
    byId.delete(photo.id);
  }
  byId.forEach((shot) => next.push(shot));
  return next;
}

export async function pushLibraryNow() {
  const session = await loadProfile();
  if (!session?.token) {
    return { count: 0 };
  }
  try {
    const shots = sessionShots().length ? sessionShots() : await loadPersistedShots();
    const snapshot = await buildSnapshot(shots);
    await pushSnapshot(session.token, snapshot);
    return { count: snapshot.photos.length };
  } catch (err) {
    console.log(`[check] snapshot failed: ${err?.message || "unreachable"}`);
    throw err;
  }
}

export async function syncLibrary() {
  const session = await loadProfile();
  if (!session?.token) {
    return { count: 0 };
  }
  try {
    const remote = await fetchSnapshot(session.token);
    const local = await loadPersistedShots();
    const merged = await mergeLibrary(local, remote.photos || [], session.token);
    await persistShots(merged, { skipSync: true });
    const snapshot = await buildSnapshot(merged);
    await pushSnapshot(session.token, snapshot);
    return { count: snapshot.photos.length };
  } catch (err) {
    console.log(`[check] snapshot failed: ${err?.message || "unreachable"}`);
    throw err;
  }
}
