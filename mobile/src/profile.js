import * as FileSystem from "expo-file-system/legacy";
import { profilePath } from "./photoPaths";

function documentRoot() {
  return FileSystem.documentDirectory || "";
}

export async function loadProfile() {
  const root = documentRoot();
  if (!root) {
    return null;
  }
  try {
    const path = profilePath(root);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      return null;
    }
    const row = JSON.parse(await FileSystem.readAsStringAsync(path));
    if (row?.username && row?.token) {
      return row;
    }
  } catch {
    // Stay signed out if the file is unreadable.
  }
  return null;
}

export async function saveProfile(session) {
  const root = documentRoot();
  if (!root) {
    return session || null;
  }
  const path = profilePath(root);
  try {
    if (!session) {
      await FileSystem.deleteAsync(path, { idempotent: true });
      return null;
    }
    await FileSystem.writeAsStringAsync(path, JSON.stringify(session));
  } catch {
    // Memory callers still hold the session.
  }
  return session || null;
}
