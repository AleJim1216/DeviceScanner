import {
  HOLD_MS,
  assignUploadViews,
  nearestCenter,
  pointInFrame,
  ringPose,
  rollerFrame,
  rollerVisible,
  settleTarget,
  visualOffset,
} from "./carouselLayout.js";
import {
  assignedGroupId,
  assignedShots,
  assignSet,
  badgeLabel,
  canAddToSet,
  canAnalyze,
  createSetNumber,
  filterItems,
  filterLabel,
  payloadGroupId,
  removeFromSets,
  setColor,
  unassignedCopy,
  usedSetNumbers,
  visibleIndexes,
} from "./grouping.js";

const THEME = {
  accent: "#1aa6a0",
  setColors: ["#1aa6a0", "#c46b2d", "#2b5f9e", "#6b4c9a", "#c44d7a", "#2f7d4a"],
  status: {
    usable: { label: "Usable", color: "#0f9f6e", tint: "#c8f5e4" },
    retake: { label: "Retake", color: "#e04f4f", tint: "#ffd6d4" },
    needs_review: { label: "Needs review", color: "#e6a100", tint: "#ffe9b0" },
  },
};

const VIEWS = [
  { id: "front", label: "Front" },
  { id: "rear_ports", label: "Rear" },
  { id: "label", label: "Label" },
];
const VIEW_IDS = VIEWS.map((item) => item.id);
const VIEW_LABEL = { front: "front", rear_ports: "rear", label: "label" };
const SESSION_KEY = "scane.session";
const SPIN = 150;
const UNREACHABLE = "Could not check this photo. Leave the computer running and try again.";

const state = {
  session: readSession(),
  pane: "storage",
  shots: [],
  selected: new Set(),
  filter: "all",
  view: "front",
  confirm: null,
  overviewOpen: false,
  analysisFilter: "all",
  analysisFocus: 0,
  analysisGrid: false,
  analysisError: "",
  analysisBusy: false,
  libraryError: "",
  libraryBusy: false,
  profileError: "",
  username: "",
  password: "",
};

const roller = {
  pos: 0,
  origin: 0,
  dragging: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastT: 0,
  vx: 0,
  holdTimer: 0,
  holdMoved: false,
  anim: 0,
};

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const row = raw ? JSON.parse(raw) : null;
    if (row?.username && row?.token) {
      return row;
    }
  } catch {
    // Stay signed out if storage is blocked.
  }
  return null;
}

function saveSession(session) {
  state.session = session;
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function viewLabel(name) {
  return VIEW_LABEL[name] || String(name || "").replaceAll("_", " ");
}

function photoUrl(id) {
  return `/account/photos/${encodeURIComponent(id)}?token=${encodeURIComponent(state.session.token)}`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.session?.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }
  const response = await fetch(path, { ...options, headers });
  return response;
}

function loginError(status) {
  if (status === 401) {
    return "That password does not match.";
  }
  if (status === 400) {
    return "Use a short username (letters, numbers, _) and a password.";
  }
  return "Could not sign in. Leave the computer running and try again.";
}

async function signIn() {
  const username = state.username.trim();
  const password = state.password;
  if (!username || password.length < 4) {
    state.profileError = "Use a short username (letters, numbers, _) and a password.";
    render();
    return;
  }
  try {
    const response = await fetch("/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      state.profileError = loginError(response.status);
      render();
      return;
    }
    const body = await response.json();
    saveSession(body);
    state.password = "";
    state.profileError = "";
    state.pane = "storage";
    await pullLibrary();
  } catch (err) {
    console.log(`[check] login failed: ${err?.message || "unreachable"}`);
    state.profileError = "Could not sign in. Leave the computer running and try again.";
    render();
  }
}

function revokeBlob(uri) {
  if (uri && String(uri).startsWith("blob:")) {
    URL.revokeObjectURL(uri);
  }
}

function signOut() {
  state.shots.forEach((shot) => revokeBlob(shot.uri));
  saveSession(null);
  state.shots = [];
  state.selected = new Set();
  state.libraryError = "";
  state.libraryBusy = false;
  state.profileError = "";
  render();
}

async function hydrateShotImages(shots) {
  await Promise.all(
    (shots || []).map(async (shot) => {
      if (!shot?.id || String(shot.uri || "").startsWith("blob:")) {
        return;
      }
      try {
        const response = await fetch(photoUrl(shot.id));
        if (!response.ok) {
          return;
        }
        const blob = await response.blob();
        if (!blob.size) {
          return;
        }
        revokeBlob(shot.uri);
        shot.uri = URL.createObjectURL(blob);
      } catch (err) {
        console.log(`[check] photo ${shot.id} failed: ${err?.message || "unreachable"}`);
      }
    })
  );
  if (state.session && state.shots === shots) {
    render();
  }
}

async function pullLibrary() {
  if (!state.session) {
    return;
  }
  state.libraryBusy = true;
  state.libraryError = "";
  try {
    const response = await api("/account/snapshot");
    if (response.status === 401) {
      console.log(`[check] snapshot 401`);
      state.libraryBusy = false;
      state.shots.forEach((shot) => revokeBlob(shot.uri));
      saveSession(null);
      state.shots = [];
      state.selected = new Set();
      state.profileError = "Sign in again with the same username as the phone.";
      render();
      return;
    }
    if (!response.ok) {
      console.log(`[check] snapshot ${response.status}`);
      state.libraryBusy = false;
      state.libraryError = UNREACHABLE;
      render();
      return;
    }
    const data = await response.json();
    const local = new Map(state.shots.map((shot) => [shot.id, shot]));
    const next = [];
    for (const photo of data.photos || []) {
      const existing = local.get(photo.id);
      const freshUri = photoUrl(photo.id);
      if (existing?.uri && existing.uri !== freshUri) {
        revokeBlob(existing.uri);
      }
      next.push({
        id: photo.id,
        name: photo.name,
        view: photo.view || photo.intended_view || "front",
        width: existing?.width,
        height: existing?.height,
        source: existing?.source || "library",
        groupId: photo.group_id == null ? null : Number(photo.group_id) || photo.group_id,
        uri: freshUri,
        image_base64: existing?.image_base64 || "",
        analysis: photo.status
          ? {
              image_id: photo.id,
              intended_view: photo.intended_view,
              status: photo.status,
              issue_codes: photo.issue_codes || [],
              reason: photo.reason || "",
              guidance: photo.guidance || "",
              view_uncertain: Boolean(photo.view_uncertain),
              group_id: photo.group_id == null ? "" : String(photo.group_id),
            }
          : existing?.analysis || null,
      });
      local.delete(photo.id);
    }
    local.forEach((shot) => next.push(shot));
    if (state.filter !== "all" && !visibleIndexes(next, state.filter).length && next.length) {
      state.filter = "all";
    }
    state.shots = next;
    state.analysisBusy = false;
    state.libraryBusy = false;
    render();
    hydrateShotImages(next);
  } catch (err) {
    console.log(`[check] snapshot failed: ${err?.message || "unreachable"}`);
    state.libraryBusy = false;
    state.libraryError = UNREACHABLE;
    render();
  }
}

async function fileToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const maxSide = 960;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(UNREACHABLE));
    reader.readAsDataURL(blob);
  });
  const comma = text.indexOf(",");
  return {
    image_base64: comma >= 0 ? text.slice(comma + 1) : text,
    uri: URL.createObjectURL(blob),
    width,
    height,
  };
}

async function shotBase64(shot) {
  if (shot.image_base64) {
    return shot.image_base64;
  }
  const response = await fetch(shot.uri);
  const blob = await response.blob();
  const packed = await fileToJpeg(blob);
  shot.image_base64 = packed.image_base64;
  return packed.image_base64;
}

function snapshotPhoto(shot) {
  const analysis = shot.analysis || {};
  const groupId = payloadGroupId(shot);
  return {
    id: shot.id,
    name: shot.name || `${shot.id}.jpg`,
    view: shot.view || "front",
    intended_view: analysis.intended_view || shot.view || "front",
    status: analysis.status || "",
    issue_codes: analysis.issue_codes || [],
    reason: analysis.reason || "",
    guidance: analysis.guidance || "",
    view_uncertain: Boolean(analysis.view_uncertain),
    group_id: groupId,
    image_base64: shot.image_base64 || "",
  };
}

function hasAnalysis(shot) {
  return Boolean(shot?.analysis?.status);
}

async function pushLibrary(options = {}) {
  if (!state.session) {
    return;
  }
  if (!state.shots.length && !options.allowEmpty) {
    return;
  }
  try {
    let photos = state.shots.map(snapshotPhoto);
    if (options.mergeRemote) {
      const current = await api("/account/snapshot");
      if (current.ok) {
        const remote = await current.json();
        const byId = new Map((remote.photos || []).map((photo) => [photo.id, photo]));
        photos.forEach((photo) => byId.set(photo.id, photo));
        photos = [...byId.values()].map((photo) => ({
          id: photo.id,
          name: photo.name,
          view: photo.view || photo.intended_view || "front",
          intended_view: photo.intended_view || photo.view || "front",
          status: photo.status || "",
          issue_codes: photo.issue_codes || [],
          reason: photo.reason || "",
          guidance: photo.guidance || "",
          view_uncertain: Boolean(photo.view_uncertain),
          group_id: photo.group_id ?? null,
          image_base64: photo.image_base64 || "",
        }));
      }
    }
    const response = await api("/account/snapshot", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photos }),
    });
    if (!response.ok) {
      console.log(`[check] snapshot put ${response.status}`);
    }
  } catch (err) {
    console.log(`[check] snapshot put failed: ${err?.message || "unreachable"}`);
  }
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) {
    return;
  }
  const views = assignUploadViews(state.view, files.length, VIEW_IDS);
  for (let offset = 0; offset < files.length; offset += 1) {
    const file = files[offset];
    const packed = await fileToJpeg(file);
    state.shots.push({
      id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name || `upload-${state.shots.length + 1}.jpg`,
      view: views[offset],
      width: packed.width,
      height: packed.height,
      source: "library",
      groupId: null,
      uri: packed.uri,
      image_base64: packed.image_base64,
      analysis: null,
    });
  }
  state.selected = new Set();
  render();
  await pushLibrary({ mergeRemote: true });
}

function commit(next, options = {}) {
  state.shots = next;
  state.selected = new Set();
  render();
  pushLibrary(options);
}

function displayPhotos() {
  return assignedShots(state.shots).map((shot) => {
    if (shot.analysis?.status) {
      return { ...shot.analysis, group_id: payloadGroupId(shot) || "", uri: shot.uri };
    }
    return {
      image_id: shot.id,
      intended_view: shot.view || "front",
      status: "",
      issue_codes: [],
      reason: "",
      guidance: "",
      view_uncertain: false,
      group_id: payloadGroupId(shot) || "",
      uri: shot.uri,
    };
  });
}

function analysisGroups(photos) {
  const order = [];
  const buckets = {};
  photos.forEach((photo, index) => {
    const groupId = String(photo.group_id || "1");
    if (!buckets[groupId]) {
      order.push(groupId);
      buckets[groupId] = [];
    }
    buckets[groupId].push(index);
  });
  return order.map((groupId, sequence) => {
    const indexes = buckets[groupId];
    const intended = indexes.filter((index) => !photos[index].view_uncertain).map((index) => photos[index].intended_view);
    const have = new Set(intended);
    return {
      group_id: groupId,
      label: /^\d+$/.test(groupId) ? `Set ${groupId}` : `Device ${sequence + 1}`,
      photo_indexes: indexes,
      missing_views: ["front", "rear_ports", "label"].filter((view) => !have.has(view)),
    };
  });
}

async function runAnalyze() {
  const rows = assignedShots(state.shots);
  if (!rows.length) {
    window.alert("Group photos into a set first.");
    return;
  }
  const fresh = rows.filter((shot) => !hasAnalysis(shot));
  state.pane = "analysis";
  state.analysisError = "";
  if (!fresh.length) {
    state.analysisBusy = false;
    render();
    return;
  }
  state.analysisBusy = true;
  render();
  try {
    const packed = [];
    for (const shot of fresh) {
      packed.push({
        view: shot.view || "front",
        name: shot.name || `${shot.id}.jpg`,
        image_base64: await shotBase64(shot),
        group_id: payloadGroupId(shot),
      });
    }
    const response = await fetch("/analyze/payload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shots: packed }),
    });
    if (!response.ok) {
      throw new Error(UNREACHABLE);
    }
    const data = await response.json();
    fresh.forEach((shot, index) => {
      shot.analysis = data.photos?.[index] || shot.analysis;
    });
    state.analysisBusy = false;
    state.analysisError = "";
    render();
    await pushLibrary();
  } catch (err) {
    console.log(`[check] analyze failed: ${err?.message || "unreachable"}`);
    state.analysisBusy = false;
    state.analysisError = UNREACHABLE;
    render();
  }
}

function toolButton(action, label, options = {}) {
  const variant = options.variant || "primary";
  const extra = options.className ? ` ${options.className}` : "";
  const icon = options.icon ? `<sl-icon slot="prefix" name="${options.icon}"></sl-icon>` : "";
  const caret = options.caret ? " caret" : "";
  const disabled = options.disabled ? " disabled" : "";
  return `<sl-button class="tool-btn${extra}" variant="${variant}" size="small" data-action="${action}"${caret}${disabled}>${icon}${escapeHtml(label)}</sl-button>`;
}

function addButtonLabel(sets, selectedCount) {
  if (!canAddToSet(selectedCount, sets)) {
    return "Add to set";
  }
  if (sets.length === 1) {
    return `Add to Set ${sets[0]}`;
  }
  return "Add to set";
}

function renderAddControl(sets, selectedCount) {
  const canAdd = canAddToSet(selectedCount, sets);
  const label = addButtonLabel(sets, selectedCount);
  if (sets.length <= 1) {
    return toolButton("add-set", label, { disabled: !canAdd });
  }
  return `
    <sl-dropdown hoist>
      <sl-button slot="trigger" class="tool-btn" variant="primary" size="small" caret ${canAdd ? "" : "disabled"}>${escapeHtml(label)}</sl-button>
      <sl-menu>
        ${sets.map((number) => `<sl-menu-item data-action="add-to" data-set="${number}">Set ${number}</sl-menu-item>`).join("")}
      </sl-menu>
    </sl-dropdown>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function leftoverStageH(stage) {
  const body = stage.closest(".analysis-body");
  const measured = body?.clientHeight || 0;
  if (measured > 0) {
    return Math.max(180, Math.round(measured));
  }
  const root = getComputedStyle(document.documentElement);
  const navH = parseFloat(root.getPropertyValue("--nav-h")) || 56;
  const main = document.querySelector("main.main");
  let extras = 0;
  for (const node of main?.children || []) {
    if (node === body || node.classList.contains("analysis-body")) {
      continue;
    }
    const css = getComputedStyle(node);
    extras += node.offsetHeight + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
  }
  return Math.max(180, Math.round(window.innerHeight - navH - extras - 12));
}

function renderNavbar(signedIn) {
  return `
    <nav class="navbar">
      <img class="title-logo" src="/assets/scan-e-logo.svg" alt="ScanE" onerror="this.src='./scan-e-logo.svg'" />
      ${
        signedIn
          ? `<div class="tab-row-tabs">
              <button class="nav-item ${state.pane === "storage" ? "is-on" : ""}" type="button" data-action="pane" data-pane="storage">Storage</button>
              <button class="nav-item ${state.pane === "analysis" ? "is-on" : ""}" type="button" data-action="pane" data-pane="analysis">Analysis</button>
            </div>
            <div class="nav-user">${escapeHtml(state.session.username)}</div>
            ${renderProfileMenu()}`
          : ""
      }
    </nav>
  `;
}

function renderProfileMenu() {
  return `
    <sl-dropdown class="profile-drop" hoist placement="bottom-end">
      <button slot="trigger" class="profile-icon" type="button" aria-label="Account">
        <sl-icon name="person-circle"></sl-icon>
      </button>
      <div class="profile-panel">
        <div class="kicker">Signed in</div>
        <div class="profile-name">${escapeHtml(state.session.username)}</div>
        ${toolButton("sign-out", "Sign out", { icon: "box-arrow-right" })}
      </div>
    </sl-dropdown>
  `;
}

function renderFilter(id, filter, sets, includeUnassigned) {
  const current = filterLabel(filter, sets, includeUnassigned);
  const items = filterItems(sets, includeUnassigned);
  return `
    <sl-dropdown class="filter-wrap" data-filter="${id}" hoist>
      <sl-button slot="trigger" class="filter-btn" variant="default" size="small" caret>${escapeHtml(current)}</sl-button>
      <sl-menu>
        ${items
          .map(
            (item) =>
              `<sl-menu-item data-action="choose-filter" data-filter="${id}" data-value="${escapeHtml(item.id)}" ${
                String(filter) === String(item.id) ? "checked" : ""
              }>${escapeHtml(item.label)}</sl-menu-item>`
          )
          .join("")}
      </sl-menu>
    </sl-dropdown>
  `;
}

function renderCell(shot, index, selected) {
  const label = badgeLabel(assignedGroupId(shot));
  const color = setColor(assignedGroupId(shot), THEME.setColors);
  const src = escapeHtml(shot.uri);
  return `
    <button class="cell ${selected ? "is-selected" : ""}" type="button" data-action="toggle-shot" data-index="${index}" style="background-image:url('${src}')">
      <img src="${src}" alt="${escapeHtml(shot.name || "Photo")}" />
      ${selected ? `<span class="selected-mark">✓</span>` : ""}
      ${label ? `<span class="set-badge" style="background:${color}">${escapeHtml(label)}</span>` : ""}
    </button>
  `;
}

function renderDetails(photo) {
  if (!photo) {
    return "";
  }
  const setNo = badgeLabel(photo.group_id);
  if (!photo.status) {
    return `
      <div class="detail-card is-progress">
        <div class="progress-row">
          <span class="progress-spin" aria-hidden="true"></span>
          <div class="progress-text">Analysis in Progress</div>
        </div>
        ${setNo ? `<div class="set-beside set-below">Set ${escapeHtml(setNo)}</div>` : ""}
      </div>
    `;
  }
  const tone = THEME.status[photo.status] || THEME.status.needs_review;
  const viewText = viewLabel(photo.intended_view);
  return `
    <div class="detail-card" style="border-left-color:${tone.color};background:${tone.tint}">
      <div class="badge-row">
        <span class="badge" style="background:${tone.color}">${escapeHtml(tone.label)}</span>
        ${setNo ? `<span class="set-beside">Set ${escapeHtml(setNo)}</span>` : ""}
      </div>
      ${
        viewText
          ? `<div class="view-block">
              <div class="view-name">${escapeHtml(viewText)}</div>
            </div>`
          : ""
      }
      ${
        photo.reason
          ? `<div class="problem-block">
              <div class="block-kicker">Problem</div>
              <div class="block-body">${escapeHtml(photo.reason)}</div>
            </div>`
          : ""
      }
      ${
        photo.guidance
          ? `<div class="solution-block">
              <div class="block-kicker">Solution</div>
              <div class="block-body">${escapeHtml(photo.guidance)}</div>
            </div>`
          : ""
      }
    </div>
  `;
}

function overviewLine(groups, ready) {
  if (!ready) {
    return groups.length > 1 ? `${groups.length} sets` : groups[0]?.label || "Current set";
  }
  if (!groups.length) {
    return "Current set";
  }
  if (groups.length > 1) {
    return `${groups.length} sets`;
  }
  const missing = groups[0].missing_views || [];
  if (!missing.length) {
    return `${groups[0].label} · All three required views`;
  }
  return `${groups[0].label} · Missing ${missing.map(viewLabel).join(", ")}`;
}

function loginReady(username, password) {
  return Boolean(String(username || "").trim() && String(password || "").length >= 4);
}

function loginFields(form) {
  return {
    username: form?.querySelector("#username"),
    password: form?.querySelector("#password"),
  };
}

function syncLoginButton(form) {
  const button = form?.querySelector("sl-button[type=submit]");
  const fields = loginFields(form);
  if (!button) {
    return;
  }
  button.disabled = !loginReady(fields.username?.value, fields.password?.value);
}

function renderLogin() {
  return `
    ${renderNavbar(false)}
    <div class="login-wrap">
      <form class="login" data-form="login">
        <h1 class="login-welcome">Welcome!</h1>
        <sl-input id="username" name="username" label="Username" autocomplete="username" value="${escapeHtml(state.username)}"></sl-input>
        <sl-input id="password" name="password" type="password" label="Password" autocomplete="current-password" password-toggle value="${escapeHtml(state.password)}"></sl-input>
        <sl-button class="signin-btn" variant="primary" type="submit">Sign in</sl-button>
        <p class="hint">Use the same username and password as Profile on the phone.</p>
        ${state.profileError ? `<p class="error-hint">${escapeHtml(state.profileError)}</p>` : ""}
      </form>
    </div>
  `;
}

function storageHint() {
  if (state.libraryBusy && !state.shots.length) {
    return "Loading photos…";
  }
  if (state.libraryError) {
    return state.libraryError;
  }
  if (!state.shots.length) {
    return `No photos on ${state.session.username} yet. Sign in on the phone with this username, then tap Sync now on Profile.`;
  }
  const shown = visibleIndexes(state.shots, state.filter);
  if (!shown.length) {
    return "No photos match this filter.";
  }
  return unassignedCopy(state.shots.filter((shot) => assignedGroupId(shot) == null).length);
}

function renderStorage() {
  const sets = usedSetNumbers(state.shots);
  const shown = visibleIndexes(state.shots, state.filter);
  const allOn = Boolean(shown.length) && shown.every((index) => state.selected.has(index));
  const canCreate = state.selected.size > 0;
  const canRemove = [...state.selected].some((index) => assignedGroupId(state.shots[index]) != null);
  const count = state.shots.length;
  return `
    <div class="chrome">
      <div class="views">
        ${VIEWS.map(
          (item) =>
            `<button class="view-chip ${state.view === item.id ? "is-on" : ""}" type="button" data-action="set-view" data-view="${item.id}">${item.label}</button>`
        ).join("")}
      </div>
      ${renderFilter("storage", state.filter, sets, true)}
      <div class="library-meta">${count} photo${count === 1 ? "" : "s"}</div>
      ${toolButton("refresh-library", "Refresh", { icon: "arrow-clockwise" })}
      ${toolButton("pick-files", "Upload", { className: "chrome-upload", icon: "cloud-upload" })}
      <input id="file-input" type="file" accept="image/*" multiple hidden />
    </div>
    <div class="toolbar">
      <div class="tool-group">
        ${toolButton("select-all", allOn ? "Deselect" : "Select all", { disabled: !shown.length })}
      </div>
      <div class="tool-group is-pair">
        ${toolButton("create-set", `Create Set (${state.selected.size})`, { disabled: !canCreate })}
        ${toolButton("remove-set", "Remove from set", { disabled: !canRemove })}
      </div>
      <div class="tool-group">
        ${renderAddControl(sets, state.selected.size)}
      </div>
      <div class="tool-group is-pair">
        ${toolButton("delete-selected", "Delete", { variant: "danger", disabled: !state.selected.size })}
        ${toolButton("delete-all", "Delete all", { variant: "danger", disabled: !state.shots.length })}
      </div>
      ${toolButton("analyze", "Analyze", { className: "toolbar-analyze", icon: "search", disabled: !canAnalyze(state.shots) })}
    </div>
    <div class="grid">
      ${shown.map((index) => renderCell(state.shots[index], index, state.selected.has(index))).join("")}
    </div>
    <p class="hint">${escapeHtml(storageHint())}</p>
  `;
}

function renderAnalysis() {
  const photos = displayPhotos();
  const sets = usedSetNumbers(photos);
  const shown = visibleIndexes(photos, state.analysisFilter);
  const shownPhotos = shown.map((index) => photos[index]);
  const groups = analysisGroups(photos);
  const listed =
    state.analysisFilter === "all" ? groups : groups.filter((group) => String(group.group_id) === String(state.analysisFilter));
  const ready = photos.some((photo) => photo.status);
  const safeFocus = Math.min(state.analysisFocus, Math.max(0, shownPhotos.length - 1));
  const photo = shownPhotos[safeFocus];
  if (!photos.length) {
    return `<p class="hint">No saved photos to check.</p>`;
  }
  const checklist = ready
    ? `<button class="checklist ${state.overviewOpen ? "" : "is-closed"}" type="button" data-action="toggle-overview">
            <div class="checklist-head">
              <div class="checklist-compact">${escapeHtml(overviewLine(listed, ready))}</div>
              <div class="checklist-chev">${state.overviewOpen ? "▴" : "▾"}</div>
            </div>
            ${
              state.overviewOpen
                ? listed
                    .map((group) => {
                      const missing = group.missing_views || [];
                      return `<div class="kicker" style="margin-top:10px">${escapeHtml(group.label)}</div>
                        <div class="checklist-title">${
                          missing.length
                            ? `Missing ${missing.map(viewLabel).join(", ")}`
                            : "All three required views are present"
                        }</div>`;
                    })
                    .join("") +
                  `<div class="checklist-body">A missing view means no photo was assigned to it. A retake is a photo that is here but not usable.</div>`
                : ""
            }
          </button>`
    : "";
  const filter = sets.length ? renderFilter("analysis", state.analysisFilter, sets, false) : "";
  const head = checklist || filter ? `<div class="analysis-head">${checklist}${filter}</div>` : "";
  return `
    ${head}
    ${
      state.analysisGrid
        ? `<div class="grid">${shownPhotos
            .map((item, index) => {
              const label = badgeLabel(item.group_id);
              const color = setColor(item.group_id, THEME.setColors);
              return `<button class="cell" type="button" data-action="pick-analysis" data-index="${index}" style="background-image:url('${escapeHtml(item.uri)}')">
                <img src="${escapeHtml(item.uri)}" alt="" />
                ${label ? `<span class="set-badge" style="background:${color}">${escapeHtml(label)}</span>` : ""}
              </button>`;
            })
            .join("")}</div>`
        : `<div class="analysis-body">
            <div class="analysis-rail">
              <div id="roller-stage" class="roller-stage"></div>
            </div>
            <div id="analysis-details" class="analysis-details">${renderDetails(photo)}</div>
          </div>`
    }
    ${
      state.analysisError
        ? `<div class="retry-row"><p class="hint">${escapeHtml(state.analysisError)}</p>${toolButton("retry-analyze", "Try again")}</div>`
        : ""
    }
  `;
}

function renderConfirm() {
  if (!state.confirm) {
    return "";
  }
  return `
    <sl-dialog class="confirm-dialog" label="Remove photos?" open>
      <p>${escapeHtml(state.confirm.message)}</p>
      <sl-button slot="footer" class="filter-btn" variant="default" size="small" data-action="cancel-confirm">Cancel</sl-button>
      <sl-button slot="footer" class="tool-btn" variant="danger" size="small" data-action="ok-confirm">Remove</sl-button>
    </sl-dialog>
  `;
}

function render() {
  const root = document.getElementById("app");
  if (!state.session) {
    root.innerHTML = renderLogin();
    bind();
    return;
  }
  if (state.pane === "profile") {
    state.pane = "storage";
  }
  root.innerHTML = `
    ${renderNavbar(true)}
    <main class="main${state.pane === "analysis" ? " is-analysis" : ""}${state.pane === "analysis" && state.analysisGrid ? " is-grid" : ""}">
      ${state.pane === "storage" ? renderStorage() : ""}
      ${state.pane === "analysis" ? renderAnalysis() : ""}
    </main>
    ${renderConfirm()}
  `;
  bind();
  if (state.pane === "analysis" && !state.analysisGrid) {
    mountRoller();
  }
}

function bind() {
  const root = document.getElementById("app");
  root.querySelectorAll("[data-action]").forEach((node) => {
    if (node.tagName === "SL-MENU-ITEM") {
      return;
    }
    node.addEventListener("click", onAction);
  });
  root.querySelectorAll("sl-menu").forEach((menu) => {
    menu.addEventListener("sl-select", (event) => {
      const item = event.detail.item;
      if (item?.dataset.action) {
        onAction({ currentTarget: item });
      }
    });
  });
  root.querySelectorAll("sl-dialog").forEach((dialog) => {
    dialog.addEventListener("sl-request-close", (event) => {
      if (event.detail.source === "overlay" || event.detail.source === "keyboard" || event.detail.source === "close-button") {
        state.confirm = null;
        render();
      }
    });
  });
  const form = root.querySelector("[data-form=login]");
  if (form) {
    const fields = loginFields(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      state.username = fields.username?.value || "";
      state.password = fields.password?.value || "";
      signIn();
    });
    const onLoginField = () => {
      state.username = fields.username?.value || "";
      state.password = fields.password?.value || "";
      syncLoginButton(form);
    };
    fields.username?.addEventListener("sl-input", onLoginField);
    fields.password?.addEventListener("sl-input", onLoginField);
    fields.username?.addEventListener("sl-change", onLoginField);
    fields.password?.addEventListener("sl-change", onLoginField);
    syncLoginButton(form);
  }
  const fileInput = root.querySelector("#file-input");
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      uploadFiles(fileInput.files);
      fileInput.value = "";
    });
  }
}

function onAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  if (action === "pane") {
    if (button.dataset.pane === "profile") {
      return;
    }
    state.pane = button.dataset.pane;
    if (state.pane === "analysis" || state.pane === "storage") {
      state.analysisBusy = false;
      render();
      pullLibrary();
      return;
    }
    render();
    return;
  }
  if (action === "refresh-library") {
    pullLibrary();
    return;
  }
  if (action === "sign-out") {
    signOut();
    return;
  }
  if (action === "set-view") {
    state.view = button.dataset.view;
    render();
    return;
  }
  if (action === "pick-files") {
    document.getElementById("file-input")?.click();
    return;
  }
  if (action === "choose-filter") {
    if (button.dataset.filter === "storage") {
      state.filter = button.dataset.value === "none" || button.dataset.value === "all" ? button.dataset.value : Number(button.dataset.value);
    } else {
      state.analysisFilter = button.dataset.value === "all" ? "all" : Number(button.dataset.value);
      state.analysisFocus = 0;
    }
    render();
    return;
  }
  if (action === "toggle-shot") {
    const index = Number(button.dataset.index);
    if (state.selected.has(index)) {
      state.selected.delete(index);
    } else {
      state.selected.add(index);
    }
    render();
    return;
  }
  if (action === "select-all") {
    const shown = visibleIndexes(state.shots, state.filter);
    const allOn = shown.length && shown.every((index) => state.selected.has(index));
    state.selected = allOn ? new Set() : new Set(shown);
    render();
    return;
  }
  if (action === "create-set") {
    commit(assignSet(state.shots, [...state.selected], createSetNumber(state.shots, [...state.selected])));
    return;
  }
  if (action === "remove-set") {
    commit(removeFromSets(state.shots, [...state.selected]));
    return;
  }
  if (action === "add-set") {
    const sets = usedSetNumbers(state.shots);
    if (sets.length === 1) {
      commit(assignSet(state.shots, [...state.selected], sets[0]));
      return;
    }
    return;
  }
  if (action === "add-to") {
    commit(assignSet(state.shots, [...state.selected], Number(button.dataset.set)));
    return;
  }
  if (action === "delete-selected") {
    if (!state.selected.size) {
      return;
    }
    state.confirm = {
      type: "selected",
      message: `Remove ${state.selected.size} photo${state.selected.size === 1 ? "" : "s"} from the app?`,
    };
    render();
    return;
  }
  if (action === "delete-all") {
    if (!state.shots.length) {
      return;
    }
    state.confirm = { type: "all", message: "Remove every saved photo from the app?" };
    render();
    return;
  }
  if (action === "cancel-confirm") {
    state.confirm = null;
    render();
    return;
  }
  if (action === "ok-confirm") {
    const kind = state.confirm?.type;
    state.confirm = null;
    if (kind === "selected") {
      commit(state.shots.filter((_, index) => !state.selected.has(index)));
      return;
    }
    if (kind === "all") {
      commit([], { allowEmpty: true });
      return;
    }
    render();
    return;
  }
  if (action === "analyze" || action === "retry-analyze") {
    runAnalyze();
    return;
  }
  if (action === "toggle-overview") {
    state.overviewOpen = !state.overviewOpen;
    render();
    return;
  }
  if (action === "pick-analysis") {
    state.analysisFocus = Number(button.dataset.index);
    state.analysisGrid = false;
    roller.pos = state.analysisFocus;
    render();
  }
}

function shownAnalysisPhotos() {
  const photos = displayPhotos();
  return visibleIndexes(photos, state.analysisFilter).map((index) => photos[index]);
}

function mountRoller() {
  const stage = document.getElementById("roller-stage");
  if (!stage) {
    return;
  }
  const photos = shownAnalysisPhotos();
  const body = stage.closest(".analysis-body");
  const leftover = leftoverStageH(stage);
  const stageW = stage.clientWidth || Math.round(((body?.clientWidth || stage.parentElement.clientWidth) - 12) * 0.75);
  const frame = rollerFrame(stageW, leftover);
  stage.style.height = `${frame.height}px`;
  if (!photos.length) {
    return;
  }
  const count = photos.length;
  roller.pos = Number.isFinite(roller.pos) ? roller.pos : state.analysisFocus;
  const centerLeft = Math.round((stageW - frame.width) / 2);
  stage.replaceChildren();
  photos.forEach((photo, item) => {
    const offset = visualOffset(item, roller.pos, count);
    if (!rollerVisible(offset)) {
      return;
    }
    const pose = ringPose(offset, frame.width);
    const card = document.createElement("div");
    card.className = "roller-card";
    card.style.left = `${centerLeft}px`;
    card.style.width = `${frame.width}px`;
    card.style.height = `${frame.height}px`;
    card.style.zIndex = String(Math.round((2 - Math.abs(offset)) * 10));
    card.style.transform = `translateX(${pose.x}px) scale(${pose.scale})`;
    const img = document.createElement("img");
    img.src = photo.uri;
    img.alt = "";
    card.appendChild(img);
    stage.appendChild(card);
  });
  const centerFrame = { x: centerLeft, y: 0, w: frame.width, h: frame.height };

  const paint = () => {
    const next = nearestCenter(roller.pos, count);
    if (next !== state.analysisFocus) {
      state.analysisFocus = next;
      const host = document.getElementById("analysis-details");
      if (host) {
        host.innerHTML = renderDetails(photos[next]);
      }
    }
    stage.replaceChildren();
    photos.forEach((photo, item) => {
      const offset = visualOffset(item, roller.pos, count);
      if (!rollerVisible(offset)) {
        return;
      }
      const pose = ringPose(offset, frame.width);
      const card = document.createElement("div");
      card.className = "roller-card";
      card.style.left = `${centerLeft}px`;
      card.style.width = `${frame.width}px`;
      card.style.height = `${frame.height}px`;
      card.style.zIndex = String(Math.round((2 - Math.abs(offset)) * 10));
      card.style.transform = `translateX(${pose.x}px) scale(${pose.scale})`;
      const img = document.createElement("img");
      img.src = photo.uri;
      img.alt = "";
      card.appendChild(img);
      stage.appendChild(card);
    });
  };

  const settle = (vx) => {
    const target = settleTarget(roller.pos, vx);
    const start = roller.pos;
    const started = performance.now();
    cancelAnimationFrame(roller.anim);
    const tick = (now) => {
      const t = Math.min(1, (now - started) / 400);
      const eased = 1 - (1 - t) ** 3;
      roller.pos = start + (target - start) * eased;
      paint();
      if (t < 1) {
        roller.anim = requestAnimationFrame(tick);
      }
    };
    roller.anim = requestAnimationFrame(tick);
  };

  stage.onpointerdown = (event) => {
    roller.startX = event.clientX;
    roller.startY = event.clientY;
    roller.lastX = event.clientX;
    roller.lastT = performance.now();
    roller.origin = roller.pos;
    roller.holdMoved = false;
    const rect = stage.getBoundingClientRect();
    const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    clearTimeout(roller.holdTimer);
    if (pointInFrame(local.x, local.y, centerFrame)) {
      roller.holdTimer = window.setTimeout(() => {
        if (!roller.holdMoved) {
          state.analysisGrid = true;
          render();
        }
      }, HOLD_MS);
    }
  };
  stage.onpointermove = (event) => {
    if (event.buttons !== 1 && !roller.dragging) {
      if (Math.abs(event.clientX - roller.startX) > 8 || Math.abs(event.clientY - roller.startY) > 8) {
        roller.holdMoved = true;
        clearTimeout(roller.holdTimer);
      }
      return;
    }
    const dx = event.clientX - roller.startX;
    const dy = event.clientY - roller.startY;
    if (!roller.dragging) {
      if (count <= 1 || Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy)) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          roller.holdMoved = true;
          clearTimeout(roller.holdTimer);
        }
        return;
      }
      roller.dragging = true;
      roller.holdMoved = true;
      clearTimeout(roller.holdTimer);
      stage.setPointerCapture(event.pointerId);
    }
    const now = performance.now();
    roller.vx = (event.clientX - roller.lastX) / Math.max(1, now - roller.lastT);
    roller.lastX = event.clientX;
    roller.lastT = now;
    roller.pos = roller.origin - dx / SPIN;
    paint();
  };
  const endDrag = () => {
    clearTimeout(roller.holdTimer);
    if (roller.dragging) {
      roller.dragging = false;
      settle(roller.vx);
    }
  };
  stage.onpointerup = endDrag;
  stage.onpointercancel = endDrag;
}

window.addEventListener("resize", () => {
  if (state.session) {
    render();
  }
});

window.addEventListener("focus", () => {
  if (state.session) {
    pullLibrary();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.session) {
    pullLibrary();
  }
});

render();
if (state.session) {
  pullLibrary();
}
