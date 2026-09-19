export function shotStoreDir(root) {
  return `${root || ""}device-shots/`;
}

export function shotIndexPath(root) {
  return `${shotStoreDir(root)}index.json`;
}

export function storedShotUri(root, id) {
  return `${shotStoreDir(root)}${id}.jpg`;
}

export function analyzeCachePath(root) {
  return `${shotStoreDir(root)}analyze.json`;
}

export function profilePath(root) {
  return `${root || ""}device-profile.json`;
}
