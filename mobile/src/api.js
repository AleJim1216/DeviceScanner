import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import { getExpoGoProjectConfig } from "expo";

const UNREACHABLE = "Could not check this photo. Leave the computer running and try again.";

function hostFrom(value) {
  if (!value) {
    return "";
  }
  const withoutScheme = String(value).replace(/^[a-z]+:\/\//i, "");
  return withoutScheme.split("/")[0].split(":")[0];
}

function isLoopback(host) {
  return !host || host === "localhost" || host === "127.0.0.1";
}

function originFrom(value) {
  if (!value) {
    return "";
  }
  const raw = String(value);
  if (/^https?:\/\//.test(raw)) {
    const origin = raw.match(/^(https?:\/\/[^/?#]+)/)?.[1] || "";
    return isLoopback(hostFrom(origin)) ? "" : origin;
  }
  const hostPort = raw.replace(/^[a-z]+:\/\//i, "").split("/")[0];
  const host = hostFrom(hostPort);
  if (isLoopback(host)) {
    return "";
  }
  const port = hostPort.includes(":") ? hostPort.split(":").pop() : "8081";
  return `http://${host}:${port}`;
}

function packagerOrigin() {
  const config = getExpoGoProjectConfig();
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
    Constants.experienceUrl,
    Constants.linkingUri,
    NativeModules.SourceCode?.scriptURL,
    config?.debuggerHost,
    config?.logUrl,
  ];
  for (const candidate of candidates) {
    const origin = originFrom(candidate);
    if (origin) {
      return origin;
    }
  }
  if (Platform.OS === "android") {
    return "http://10.0.2.2:8081";
  }
  return "";
}

function serverUrl() {
  const origin = packagerOrigin();
  return origin ? `${origin}/model` : "";
}

async function request(path, options) {
  const base = serverUrl();
  if (!base) {
    throw new Error(UNREACHABLE);
  }
  try {
    return await fetch(`${base}${path}`, options);
  } catch {
    throw new Error(UNREACHABLE);
  }
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

export async function analyzeShots(shots) {
  const body = new FormData();
  shots.forEach((shot, index) => {
    body.append("files", {
      uri: shot.uri,
      name: shot.name || `shot-${index + 1}.jpg`,
      type: "image/jpeg",
    });
    body.append("views", shot.view);
  });
  const response = await request("/analyze", {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export function imageUrl(imageId) {
  return `${serverUrl()}/images/${imageId}`;
}
