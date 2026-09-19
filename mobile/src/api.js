import { NativeModules, Platform } from "react-native";
import {
  analyzeResult,
  mergeAnalyzed,
  partitionShots,
  rememberAnalyzed,
  shouldSendAll,
} from "./analyzeCache";
import { payloadGroupId } from "./grouping";
import { persistAnalyzeCache } from "./photoStore";
import Constants from "expo-constants";
import { getExpoGoProjectConfig } from "expo";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";

const UPLOAD_MAX_SIDE = 960;
const HEALTH_MS = 4000;

const UNREACHABLE = "Could not check this photo. Leave the computer running and try again.";
const TUNNEL_ORIGIN = "https://tzo5ric-alejj1216-8081.exp.direct";
const LAN_PACKAGER = "http://10.245.114.154:8081";

let cachedBase = "";

function hostFrom(value) {
  if (!value) {
    return "";
  }
  const withoutScheme = String(value).replace(/^[a-z]+:\/\//i, "");
  return withoutScheme.split("/")[0].split(":")[0];
}

function isLoopback(host) {
  return !host || host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function originFrom(value) {
  if (!value) {
    return "";
  }
  const raw = String(value).trim();
  if (/^https?:\/\//i.test(raw)) {
    const origin = raw.match(/^(https?:\/\/[^/?#]+)/i)?.[1] || "";
    return isLoopback(hostFrom(origin)) ? "" : origin;
  }
  const hostPort = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
  const host = hostFrom(hostPort);
  if (isLoopback(host)) {
    return "";
  }
  if (!hostPort.includes(":")) {
    return isIp(host) ? `http://${host}:8081` : `https://${host}`;
  }
  const port = hostPort.split(":").pop();
  if (!isIp(host) && (port === "443" || port === "80")) {
    return port === "443" ? `https://${host}` : `http://${host}`;
  }
  const scheme = !isIp(host) && port === "443" ? "https" : "http";
  return `${scheme}://${host}:${port}`;
}

function androidEmulator() {
  if (Platform.OS !== "android") {
    return false;
  }
  const constants = Platform.constants || {};
  const fingerprint = String(constants.Fingerprint || "");
  const model = String(constants.Model || "");
  return /generic|emulator|sdk_gphone/i.test(`${fingerprint} ${model}`);
}

function discoveredOrigins() {
  const origins = [];
  const add = (value) => {
    const origin = originFrom(value);
    if (origin && !origins.includes(origin)) {
      origins.push(origin);
    }
  };
  if (Platform.OS === "web" && typeof location !== "undefined" && location.origin) {
    add(location.origin);
  }
  if (androidEmulator()) {
    add("http://10.0.2.2:8081");
    return origins;
  }
  const config = getExpoGoProjectConfig();
  add(LAN_PACKAGER);
  [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
    Constants.experienceUrl,
    Constants.linkingUri,
    NativeModules.SourceCode?.scriptURL,
    config?.debuggerHost,
    config?.logUrl,
    TUNNEL_ORIGIN,
  ].forEach(add);
  return origins;
}

function candidateBases() {
  return discoveredOrigins().map((origin) => `${origin.replace(/\/$/, "")}/model`);
}

function keepResponse(status) {
  if (status >= 200 && status < 300) {
    return true;
  }
  if (status === 503) {
    return true;
  }
  return status >= 400 && status < 500 && status !== 404;
}

function serverUrl() {
  return cachedBase || candidateBases()[0] || `${LAN_PACKAGER}/model`;
}

async function probe(base) {
  const url = `${base}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_MS);
  try {
    const response = await fetch(url, {
      headers: { "ngrok-skip-browser-warning": "1" },
      signal: controller.signal,
    });
    console.log(`[check] health ${url} -> ${response.status}`);
    return { ok: response.ok, status: response.status };
  } catch (err) {
    console.log(`[check] health ${url} failed: ${err?.message || "unreachable"}`);
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function modelBase() {
  if (cachedBase) {
    return cachedBase;
  }
  const bases = candidateBases();
  let reachable = "";
  for (const base of bases) {
    const result = await probe(base);
    if (result.ok) {
      cachedBase = base;
      return base;
    }
    if (result.status && !reachable) {
      reachable = base;
    }
  }
  return reachable || bases[0] || `${LAN_PACKAGER}/model`;
}

async function request(path, options) {
  const tried = [];
  const first = await modelBase();
  const bases = [first, ...candidateBases().filter((base) => base !== first)];
  let lastStatus = 0;
  const method = options?.method || "GET";
  for (const base of bases) {
    if (tried.includes(base)) {
      continue;
    }
    tried.push(base);
    const url = `${base}${path}`;
    console.log(`[check] ${method} ${url}`);
    try {
      const headers = { ...(options?.headers || {}), "ngrok-skip-browser-warning": "1" };
      const response = await fetch(url, { ...options, headers });
      console.log(`[check] ${method} ${url} -> ${response.status}`);
      lastStatus = response.status;
      if (keepResponse(response.status)) {
        cachedBase = base;
        return response;
      }
    } catch (err) {
      console.log(`[check] ${method} ${url} failed: ${err?.message || "unreachable"}`);
    }
    if (cachedBase === base) {
      cachedBase = "";
    }
  }
  if (lastStatus) {
    throw new Error(UNREACHABLE);
  }
  throw new Error(UNREACHABLE);
}

async function readError(response) {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") {
      return UNREACHABLE;
    }
  } catch {
    // The phone should not show server text.
  }
  return UNREACHABLE;
}

export async function fetchSets() {
  const response = await request("/sets");
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function analyzeSet(setId) {
  const response = await request("/analyze/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set_id: setId }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function uriToBase64(uri) {
  try {
    const text = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (text) {
      return text;
    }
  } catch {
    // Some picker URIs still need a blob read.
  }
  const file = await fetch(uri);
  const blob = await file.blob();
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(UNREACHABLE));
    reader.readAsDataURL(blob);
  });
  const comma = text.indexOf(",");
  return comma >= 0 ? text.slice(comma + 1) : text;
}

function resizeAction(width, height) {
  if (width >= height) {
    return { width: UPLOAD_MAX_SIDE };
  }
  return { height: UPLOAD_MAX_SIDE };
}

async function uriToUploadBase64(uri, width, height) {
  const knownWidth = Number(width) || 0;
  const knownHeight = Number(height) || 0;
  const knownMax = Math.max(knownWidth, knownHeight);
  if (knownMax > 0 && knownMax <= UPLOAD_MAX_SIDE) {
    return uriToBase64(uri);
  }
  try {
    const context = ImageManipulator.manipulate(uri);
    if (knownMax > UPLOAD_MAX_SIDE) {
      context.resize(resizeAction(knownWidth, knownHeight));
    }
    const rendered = await context.renderAsync();
    let image = rendered;
    if (knownMax <= 0 && Math.max(rendered.width, rendered.height) > UPLOAD_MAX_SIDE) {
      const again = ImageManipulator.manipulate(uri);
      again.resize(resizeAction(rendered.width, rendered.height));
      image = await again.renderAsync();
    }
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.75,
      base64: true,
    });
    if (saved.base64) {
      return saved.base64;
    }
  } catch {
    // Fall back to the stored file if the manipulator cannot read this URI.
  }
  return uriToBase64(uri);
}

export async function packShot(shot, index) {
  const row = {
    view: shot.view,
    name: shot.name || `shot-${index + 1}.jpg`,
    image_base64: await uriToUploadBase64(shot.uri, shot.width, shot.height),
  };
  const groupId = payloadGroupId(shot);
  if (groupId) {
    row.group_id = groupId;
  }
  return row;
}

async function postPacked(packed) {
  const response = await request("/analyze/payload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shots: packed }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function analyzeShots(shots) {
  const { cached, fresh } = partitionShots(shots);
  if (!fresh.length) {
    const photos = new Array(shots.length);
    cached.forEach((row) => {
      photos[row.index] = row.photo;
    });
    await persistAnalyzeCache();
    return analyzeResult(photos);
  }

  if (shouldSendAll(shots, fresh)) {
    const packed = await Promise.all(shots.map((shot, index) => packShot(shot, index)));
    const data = await postPacked(packed);
    rememberAnalyzed(shots, data.photos);
    await persistAnalyzeCache();
    return data;
  }

  const packed = await Promise.all(fresh.map((row) => packShot(row.shot, row.index)));
  const data = await postPacked(packed);
  const merged = mergeAnalyzed(shots, cached, fresh, data.photos);
  await persistAnalyzeCache();
  return merged;
}

export function imageUrl(imageId) {
  return `${serverUrl()}/images/${imageId}`;
}

function signInError(status) {
  if (status === 401) {
    return "That password does not match.";
  }
  if (status === 400) {
    return "Use a short username (letters, numbers, _) and a password.";
  }
  return UNREACHABLE;
}

export async function signIn(username, password) {
  const response = await request("/account/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(signInError(response.status));
  }
  return response.json();
}

export async function fetchSnapshot(token) {
  const response = await request("/account/snapshot", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(UNREACHABLE);
  }
  return response.json();
}

export async function pushSnapshot(token, snapshot) {
  const response = await request("/account/snapshot", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) {
    throw new Error(UNREACHABLE);
  }
  return response.json();
}

export async function accountPhotoUrl(photoId, token) {
  const base = await modelBase();
  return `${base}/account/photos/${encodeURIComponent(photoId)}?token=${encodeURIComponent(token)}`;
}
