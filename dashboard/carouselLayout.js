export const PEEK = 36;
export const RING_PEEK = 36;
export const SIDE_GAP = 12;
export const SIDE_SCALE = 0.72;
export const FALLBACK_ASPECT = 3 / 4;
export const HOLD_MS = 1000;
export const VISIBLE_SPAN = 1.2;

export function aspectFromSize(width, height) {
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  return width / height;
}

export function fitSize(aspect, stageW, maxH) {
  const safeAspect = aspect > 0 ? aspect : FALLBACK_ASPECT;
  const maxW = Math.max(1, stageW - RING_PEEK * 2 - SIDE_GAP);
  let width = maxW;
  let height = width / safeAspect;
  if (height > maxH) {
    height = maxH;
    width = height * safeAspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

export function rollerFrame(stageW, stageH) {
  return fitSize(FALLBACK_ASPECT, stageW, stageH);
}

export function visualOffset(item, position, count) {
  if (count < 1) {
    return 0;
  }
  let delta = item - position;
  delta -= count * Math.round(delta / count);
  return delta;
}

export function rollerVisible(offset) {
  return Math.abs(offset) <= VISIBLE_SPAN;
}

export function rollerClear(position, count, width) {
  const poses = [];
  for (let item = 0; item < count; item += 1) {
    const offset = visualOffset(item, position, count);
    if (!rollerVisible(offset)) {
      continue;
    }
    poses.push(ringPose(offset, width));
  }
  for (let i = 0; i < poses.length; i += 1) {
    for (let j = i + 1; j < poses.length; j += 1) {
      if (!framesSeparate(width, poses[i].x, poses[i].scale, width, poses[j].x, poses[j].scale)) {
        return false;
      }
    }
  }
  return true;
}

export function nearestCenter(position, count) {
  return wrapIndex(Math.round(position), 0, count);
}

export function settleTarget(position, vx = 0) {
  if (vx < -0.45) {
    return Math.floor(position) + 1;
  }
  if (vx > 0.45) {
    return Math.ceil(position) - 1;
  }
  return Math.round(position);
}

export function sharedFrame(sizes, stageW, stageH) {
  const list = sizes.length ? sizes : [{ width: 1, height: 1 }];
  let width = Math.max(...list.map((size) => size.width), 1);
  let height = Math.max(...list.map((size) => size.height), 1);
  if (stageW > 0 && width > stageW) {
    height = Math.round((height * stageW) / width);
    width = stageW;
  }
  if (stageH > 0 && height > stageH) {
    width = Math.round((width * stageH) / height);
    height = stageH;
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

export function ringSpacing(width, scale = SIDE_SCALE, gap = SIDE_GAP) {
  return Math.round((Math.max(0, width) * (1 + scale)) / 2 + gap);
}

export function wrapIndex(index, offset, count) {
  if (count < 1) {
    return 0;
  }
  return ((index + offset) % count + count) % count;
}

export function ringSlots(count) {
  if (count <= 1) {
    return [0];
  }
  if (count === 2 || count === 3) {
    return [-1, 0, 1];
  }
  return [-2, -1, 0, 1, 2];
}

export function ringPose(pos, width = 0) {
  const clamped = Math.max(-2, Math.min(2, pos));
  const away = Math.abs(clamped);
  return {
    x: clamped * ringSpacing(width),
    scale: Number(Math.min(1, 1 - Math.min(0.32, away * 0.28)).toFixed(3)),
  };
}

export function splitSpin(progress) {
  const steps = progress >= 0 ? Math.floor(progress) : Math.ceil(progress);
  return { steps, fraction: progress - steps };
}

export function ringStyle(spin, slot, width = 0) {
  const inputs = [-2, -1, 0, 1, 2];
  return {
    translateX: spin.interpolate({
      inputRange: inputs,
      outputRange: inputs.map((spinPos) => ringPose(slot - spinPos, width).x),
      extrapolate: "clamp",
    }),
    scale: spin.interpolate({
      inputRange: inputs,
      outputRange: inputs.map((spinPos) => Math.min(1, ringPose(slot - spinPos, width).scale)),
      extrapolate: "clamp",
    }),
  };
}

export function ringZ(slot, turn) {
  return Math.round((2 - Math.abs(slot - turn)) * 10);
}

export function ringIndexes(index, count) {
  return ringSlots(count).map((slot) => wrapIndex(index, slot, count));
}

export function framesSeparate(widthA, xA, scaleA, widthB, xB, scaleB) {
  const rightA = xA + (widthA * scaleA) / 2;
  const leftB = xB - (widthB * scaleB) / 2;
  const rightB = xB + (widthB * scaleB) / 2;
  const leftA = xA - (widthA * scaleA) / 2;
  return rightA <= leftB || rightB <= leftA;
}

export function pointInFrame(x, y, frame) {
  return x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h;
}

export function assignUploadViews(startView, count, views) {
  const view = views.includes(startView) ? startView : views[0];
  return Array.from({ length: count }, () => view);
}

export function gridCellSize(windowWidth, pad = 16, gap = 8) {
  const cellW = Math.max(80, Math.floor((Math.max(windowWidth, 1) - pad * 2 - gap) / 2));
  const cellH = Math.round(cellW / FALLBACK_ASPECT);
  return { cellW, cellH, gap, pad };
}
