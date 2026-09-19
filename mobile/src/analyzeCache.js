import { payloadGroupId } from "./grouping";

const REQUIRED_VIEWS = ["front", "rear_ports", "label"];

const photosByKey = new Map();

export function cacheKey(shot) {
  return `${shot?.id || ""}|${shot?.uri || ""}`;
}

export function clearAnalyzeCache() {
  photosByKey.clear();
}

export function forgetShots(shots) {
  for (const shot of shots || []) {
    photosByKey.delete(cacheKey(shot));
  }
}

export function cachedPhotoFor(shot) {
  const row = photosByKey.get(cacheKey(shot));
  if (!row || row.uri !== (shot?.uri || "")) {
    return null;
  }
  return row.photo;
}

export function rememberAnalyzed(shots, photos) {
  (shots || []).forEach((shot, index) => {
    const photo = photos?.[index];
    if (!shot?.uri || !photo) {
      return;
    }
    photosByKey.set(cacheKey(shot), { uri: shot.uri, photo });
  });
}

export function cacheEntries() {
  return Array.from(photosByKey.entries()).map(([key, value]) => ({
    key,
    uri: value.uri,
    photo: value.photo,
  }));
}

export function restoreCache(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return;
  }
  photosByKey.clear();
  for (const row of entries) {
    if (row?.key && row.uri && row.photo) {
      photosByKey.set(row.key, { uri: row.uri, photo: row.photo });
    }
  }
}

export function applyShotGroup(photo, shot) {
  const groupId = payloadGroupId(shot);
  if (!groupId) {
    return { ...photo };
  }
  return { ...photo, group_id: groupId };
}

export function missingViews(intended) {
  const have = new Set(intended || []);
  return REQUIRED_VIEWS.filter((view) => !have.has(view));
}

export function buildAnalyzeGroups(photos) {
  const order = [];
  const buckets = {};
  (photos || []).forEach((photo, index) => {
    const groupId = String(photo?.group_id || "1");
    if (!buckets[groupId]) {
      order.push(groupId);
      buckets[groupId] = [];
    }
    buckets[groupId].push(index);
  });
  return order.map((groupId, sequence) => {
    const indexes = buckets[groupId];
    const intended = indexes
      .filter((index) => !photos[index]?.view_uncertain)
      .map((index) => photos[index].intended_view);
    return {
      group_id: groupId,
      label: /^\d+$/.test(groupId) ? `Set ${groupId}` : `Device ${sequence + 1}`,
      photo_indexes: indexes,
      missing_views: missingViews(intended),
    };
  });
}

export function analyzeResult(photos) {
  const groups = buildAnalyzeGroups(photos);
  return {
    set_id: null,
    device_id: null,
    missing_views: groups.length === 1 ? groups[0].missing_views : [],
    photos,
    groups,
  };
}

export function partitionShots(shots) {
  const cached = [];
  const fresh = [];
  (shots || []).forEach((shot, index) => {
    const photo = cachedPhotoFor(shot);
    if (photo) {
      cached.push({ index, shot, photo: applyShotGroup(photo, shot) });
    } else {
      fresh.push({ index, shot });
    }
  });
  return { cached, fresh };
}

export function shouldSendAll(shots, fresh) {
  if (!fresh?.length) {
    return false;
  }
  if (fresh.length === (shots || []).length) {
    return true;
  }
  return (shots || []).some((shot) => payloadGroupId(shot) == null);
}

export function pendingPhotos(shots) {
  return (shots || []).map((shot, index) => ({
    image_id: shot.id || shot.name || `shot-${index + 1}`,
    intended_view: shot.view || "front",
    status: "",
    issue_codes: [],
    reason: "",
    guidance: "",
    view_uncertain: false,
    group_id: payloadGroupId(shot) || "",
  }));
}

export function resultFromCache(shots) {
  const { cached, fresh } = partitionShots(shots || []);
  if (!shots?.length || fresh.length) {
    return null;
  }
  const photos = new Array(shots.length);
  cached.forEach((row) => {
    photos[row.index] = row.photo;
  });
  if (photos.some((photo) => !photo)) {
    return null;
  }
  return analyzeResult(photos);
}

export function photoForShot(shot, result) {
  const cached = cachedPhotoFor(shot);
  if (cached) {
    return applyShotGroup(cached, shot);
  }
  const pending = pendingPhotos([shot])[0];
  const imageId = shot?.id || shot?.name;
  const matched = (result?.photos || []).find(
    (photo) => photo?.status && imageId && photo.image_id === imageId
  );
  return matched ? applyShotGroup(matched, shot) : pending;
}

export function displayPhotos(shots, result) {
  return (shots || []).map((shot) => photoForShot(shot, result));
}

export function mergeAnalyzed(shots, cachedRows, freshRows, freshPhotos) {
  const photos = new Array((shots || []).length);
  (cachedRows || []).forEach((row) => {
    photos[row.index] = row.photo;
  });
  (freshRows || []).forEach((row, offset) => {
    photos[row.index] = applyShotGroup(freshPhotos?.[offset], row.shot);
  });
  rememberAnalyzed(shots, photos);
  return analyzeResult(photos);
}
