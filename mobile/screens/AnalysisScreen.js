import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { analyzeShots, imageUrl } from "../src/api";
import { pushLibraryNow, syncLibrary } from "../src/dashboardSync";
import { displayPhotos, resultFromCache } from "../src/analyzeCache";
import SetFilterBar from "../src/SetFilterBar";
import {
  addToSetLabel,
  assignedGroupId,
  assignSet,
  badgeLabel,
  nextSetNumber,
  scopedShots,
  storageFilterFromShot,
  usedSetNumbers,
  visibleIndexes,
} from "../src/grouping";
import { loadPersistedShots, persistShots } from "../src/photoStore";
import { sessionShots } from "../src/sessionShots";
import { theme } from "../src/theme";
import {
  HOLD_MS,
  nearestCenter,
  pointInFrame,
  ringPose,
  rollerFrame,
  rollerVisible,
  settleTarget,
  visualOffset,
} from "../src/carouselLayout";

const VIEW_LABEL = {
  front: "front",
  rear_ports: "rear",
  label: "label",
};

function viewLabel(name) {
  if (!name) {
    return "";
  }
  return VIEW_LABEL[name] || name.replaceAll("_", " ");
}

const STATUS = theme.status;

function photoUri(photo, index, previews) {
  return previews?.[index] || imageUrl(photo.image_id);
}

const SPIN = 150;

function PhotoDetails({ photo, groupLabel, shot }) {
  if (!photo) {
    return null;
  }
  const setNo = badgeLabel(shot ? assignedGroupId(shot) : (photo.group_id ?? photo.groupId));
  if (!photo.status) {
    return (
      <View style={[styles.details, styles.detailCard, styles.progressCard]}>
        <View style={styles.progressRow}>
          <ActivityIndicator size="small" color={theme.accent} />
          <Text style={styles.progressText}>Analysis in Progress</Text>
        </View>
        {setNo ? <Text style={[styles.setBeside, styles.setBelow]}>Set {setNo}</Text> : null}
      </View>
    );
  }
  const tone = STATUS[photo.status] || STATUS.needs_review;
  const viewText = groupLabel ? `${groupLabel} · ${viewLabel(photo.intended_view)}` : viewLabel(photo.intended_view);
  return (
    <View style={[styles.details, styles.detailCard, { borderLeftColor: tone.color, backgroundColor: tone.tint }]}>
      <View style={styles.badgeRow}>
        <View style={[styles.badge, { backgroundColor: tone.color }]}>
          <Text style={styles.badgeText}>{tone.label}</Text>
        </View>
        {setNo ? <Text style={styles.setBeside}>Set {setNo}</Text> : null}
      </View>
      {viewText ? (
        <View style={styles.viewBlock} testID="viewBlock">
          <Text style={styles.viewName}>{viewText}</Text>
        </View>
      ) : null}
      {photo.reason ? (
        <View style={styles.problemBlock} testID="problemBlock">
          <Text style={styles.blockKicker}>Problem</Text>
          <Text style={styles.blockBody}>{photo.reason}</Text>
        </View>
      ) : null}
      {photo.guidance ? (
        <View style={styles.solutionBlock} testID="solutionBlock">
          <Text style={styles.blockKicker}>Solution</Text>
          <Text style={styles.blockBody}>{photo.guidance}</Text>
        </View>
      ) : null}
    </View>
  );
}

function overviewLine(groups, setId, ready) {
  if (!ready) {
    if (groups?.length > 1) {
      return `${groups.length} sets`;
    }
    return setId || groups?.[0]?.label || "Current set";
  }
  if (!groups?.length) {
    return setId || "Current set";
  }
  if (groups.length === 1) {
    const group = groups[0];
    const missing = group.missing_views || [];
    const name = group.label || setId || "Current set";
    return missing.length ? `${name} · Missing ${missing.map(viewLabel).join(", ")}` : `${name} · All views present`;
  }
  return `${groups.length} sets`;
}

function PhotoCarousel({ photos, previews, itemKeys, initialIndex, onFocus, onHoldCenter }) {
  const window = useWindowDimensions();
  const [stageW, setStageW] = useState(window.width);
  const maxPhotoH = Math.max(180, Math.round(window.height * 0.4));
  const frame = rollerFrame(stageW, maxPhotoH);
  const position = useRef(new Animated.Value(initialIndex)).current;
  const posRef = useRef(initialIndex);
  const originRef = useRef(initialIndex);
  const [posNow, setPosNow] = useState(initialIndex);
  const countRef = useRef(photos.length);
  countRef.current = photos.length;
  const onFocusRef = useRef(onFocus);
  const onHoldCenterRef = useRef(onHoldCenter);
  const holdTimerRef = useRef(null);
  const holdMovedRef = useRef(false);
  const holdOriginRef = useRef({ x: 0, y: 0 });
  const centerFrameRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  onFocusRef.current = onFocus;
  onHoldCenterRef.current = onHoldCenter;

  useEffect(() => {
    const id = position.addListener(({ value }) => {
      posRef.current = value;
      setPosNow(value);
    });
    return () => position.removeListener(id);
  }, [position]);

  const [focused, setFocused] = useState(nearestCenter(initialIndex, photos.length || 1));
  useEffect(() => {
    if (Math.abs(posNow - Math.round(posNow)) > 0.12) {
      return;
    }
    const next = nearestCenter(posNow, photos.length || 1);
    setFocused((current) => (current === next ? current : next));
  }, [posNow, photos.length]);
  useEffect(() => {
    onFocusRef.current(focused);
  }, [focused]);

  useEffect(() => {
    return () => clearTimeout(holdTimerRef.current);
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        countRef.current > 1 && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        position.stopAnimation((value) => {
          posRef.current = value;
          originRef.current = value;
        });
        holdMovedRef.current = true;
        clearTimeout(holdTimerRef.current);
      },
      onPanResponderMove: (_, gesture) => {
        holdMovedRef.current = true;
        clearTimeout(holdTimerRef.current);
        if (countRef.current <= 1) {
          return;
        }
        position.setValue(originRef.current - gesture.dx / SPIN);
      },
      onPanResponderRelease: (_, gesture) => {
        holdMovedRef.current = true;
        clearTimeout(holdTimerRef.current);
        if (countRef.current <= 1) {
          return;
        }
        const target = settleTarget(posRef.current, gesture.vx);
        Animated.timing(position, {
          toValue: target,
          duration: 400,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: false,
        }).start();
      },
      onPanResponderTerminate: () => {
        clearTimeout(holdTimerRef.current);
        Animated.timing(position, {
          toValue: settleTarget(posRef.current, 0),
          duration: 320,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: false,
        }).start();
      },
    })
  ).current;

  if (!photos.length) {
    return <View style={[styles.stage, { height: frame.height }]} />;
  }

  centerFrameRef.current = {
    x: Math.round((stageW - frame.width) / 2),
    y: 0,
    w: frame.width,
    h: frame.height,
  };

  return (
    <View
      style={[styles.stage, { height: frame.height }]}
      onLayout={(event) => {
        const w = Math.round(event.nativeEvent.layout.width);
        if (w > 0) {
          setStageW((current) => (current === w ? current : w));
        }
      }}
      onTouchStart={(event) => {
        holdMovedRef.current = false;
        clearTimeout(holdTimerRef.current);
        const { locationX, locationY, pageX, pageY } = event.nativeEvent;
        holdOriginRef.current = { x: pageX, y: pageY };
        if (pointInFrame(locationX, locationY, centerFrameRef.current)) {
          holdTimerRef.current = setTimeout(() => {
            if (!holdMovedRef.current) {
              onHoldCenterRef.current();
            }
          }, HOLD_MS);
        }
      }}
      onTouchMove={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        if (
          Math.abs(pageX - holdOriginRef.current.x) > 8 ||
          Math.abs(pageY - holdOriginRef.current.y) > 8
        ) {
          holdMovedRef.current = true;
          clearTimeout(holdTimerRef.current);
        }
      }}
      onTouchEnd={() => clearTimeout(holdTimerRef.current)}
      onTouchCancel={() => clearTimeout(holdTimerRef.current)}
      {...pan.panHandlers}
    >
      {photos.map((photo, item) => {
        const offset = visualOffset(item, posNow, photos.length);
        if (!rollerVisible(offset)) {
          return null;
        }
        const pose = ringPose(offset, frame.width);
        return (
          <View
            key={itemKeys?.[item] || previews?.[item] || String(item)}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: Math.round((stageW - frame.width) / 2),
              top: 0,
              width: frame.width,
              height: frame.height,
              zIndex: Math.round((2 - Math.abs(offset)) * 10),
              elevation: Math.round((2 - Math.abs(offset)) * 10),
              borderRadius: 12,
              overflow: "hidden",
              transform: [{ translateX: pose.x }, { scale: pose.scale }],
            }}
          >
            <Image source={{ uri: photoUri(photo, item, previews) }} style={styles.photo} resizeMode="cover" />
          </View>
        );
      })}
    </View>
  );
}

export default function AnalysisScreen({ navigation, route }) {
  const incoming = route.params?.result;
  const scopeType = route.params?.scope?.type || "storage";
  const scopeSet = route.params?.scope?.setNumber;
  const scopeIds = route.params?.scope?.shotIds;
  const scopeIdKey = Array.isArray(scopeIds) ? scopeIds.join(",") : "";
  const [shots, setShots] = useState(() =>
    scopedShots(route.params?.shots?.length ? route.params.shots : sessionShots(), {
      type: route.params?.scope?.type || "storage",
      setNumber: route.params?.scope?.setNumber,
      shotIds: route.params?.scope?.shotIds,
    })
  );
  const [previews, setPreviews] = useState(() =>
    scopedShots(route.params?.shots?.length ? route.params.shots : sessionShots(), {
      type: route.params?.scope?.type || "storage",
      setNumber: route.params?.scope?.setNumber,
      shotIds: route.params?.scope?.shotIds,
    }).map((shot) => shot.uri)
  );
  const [result, setResult] = useState(() => incoming || resultFromCache(shots));
  const [error, setError] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [filter, setFilter] = useState("all");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [hydrated, setHydrated] = useState(Boolean(incoming || shots.length));
  const [storedSets, setStoredSets] = useState(() => usedSetNumbers(sessionShots()));
  const [addOpen, setAddOpen] = useState(false);
  const [addAnchor, setAddAnchor] = useState({ x: 16, y: 72, w: 180 });
  const addButtonRef = useRef(null);
  const onFocus = useRef((index) => setFocusedIndex(index)).current;
  const shotKey = (shots || []).map((shot) => `${shot.uri}|${shot.view}|${shot.groupId ?? ""}`).join(";");

  useFocusEffect(
    useCallback(() => {
      if (incoming) {
        setHydrated(true);
        return undefined;
      }
      let cancelled = false;
      loadPersistedShots().then((stored) => {
        if (cancelled) {
          return;
        }
        const scoped = scopedShots(stored, { type: scopeType, setNumber: scopeSet, shotIds: scopeIds });
        setShots(scoped);
        setPreviews(scoped.map((shot) => shot.uri));
        setStoredSets(usedSetNumbers(stored));
        setHydrated(true);
      });
      return () => {
        cancelled = true;
      };
    }, [incoming, scopeType, scopeSet, scopeIdKey])
  );

  useEffect(() => {
    if (incoming || !shots?.length) {
      return undefined;
    }
    const cached = resultFromCache(shots);
    if (cached) {
      setResult(cached);
      setError("");
      pushLibraryNow().catch(() => {});
      return undefined;
    }
    let cancelled = false;
    async function runCheck() {
      try {
        const data = await analyzeShots(shots);
        if (!cancelled) {
          setResult(data);
          setError("");
          pushLibraryNow().catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setError("Could not check this photo. Leave the computer running and try again.");
        }
      }
    }
    runCheck();
    return () => {
      cancelled = true;
    };
  }, [incoming, shotKey, shots, retryTick]);

  useEffect(() => {
    setFocusedIndex(0);
  }, [filter]);

  useEffect(() => {
    const canAdd = shots.length === 1 && assignedGroupId(shots[0]) == null;
    if (!canAdd && addOpen) {
      setAddOpen(false);
    }
  }, [shots, addOpen]);

  function openStorage() {
    const photos = displayPhotos(shots, result);
    const shown = visibleIndexes(photos, filter);
    const safeFocus = Math.min(focusedIndex, Math.max(0, shown.length - 1));
    const shot = shots[shown[safeFocus]] || shots[0];
    navigation.navigate("Photos", {
      shots: sessionShots(),
      filter: storageFilterFromShot(shot),
    });
  }

  async function addSingleToSet(setNumber) {
    const stored = await loadPersistedShots();
    const ids = new Set((shots || []).map((shot) => shot.id).filter(Boolean));
    const indexes = stored.reduce((list, shot, index) => {
      if (ids.has(shot.id)) {
        list.push(index);
      }
      return list;
    }, []);
    if (!indexes.length) {
      return;
    }
    setAddOpen(false);
    const number = setNumber == null ? nextSetNumber(stored) : setNumber;
    const next = assignSet(stored, indexes, number);
    await persistShots(next);
    syncLibrary();
    const scoped = scopedShots(next, { type: scopeType, setNumber: scopeSet, shotIds: scopeIds });
    setShots(scoped);
    setPreviews(scoped.map((shot) => shot.uri));
    setStoredSets(usedSetNumbers(next));
  }

  function openAddMenu() {
    if (storedSets.length <= 1) {
      addSingleToSet(storedSets[0] ?? null);
      return;
    }
    if (addOpen) {
      setAddOpen(false);
      return;
    }
    const node = addButtonRef.current;
    if (!node?.measureInWindow) {
      setAddOpen(true);
      return;
    }
    node.measureInWindow((x, y, width) => {
      setAddAnchor({
        x: Math.max(16, x),
        y: Math.max(16, y - 244),
        w: Math.max(width, 180),
      });
      setAddOpen(true);
    });
  }

  if (hydrated && !incoming && !shots?.length) {
    return (
      <View style={styles.center}>
        <StatusBar style="dark" />
        <Text style={styles.hint}>No saved photos to check.</Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => navigation.navigate("Camera")}
        >
          <Text style={styles.buttonText}>Back to camera</Text>
        </Pressable>
      </View>
    );
  }

  const photos = displayPhotos(shots, result);
  const sets = usedSetNumbers(photos);
  const shown = visibleIndexes(photos, filter);
  const shownPhotos = shown.map((index) => photos[index]);
  const shownPreviews = shown.map((index) => previews?.[index] || photoUri(photos[index], index, previews));
  const shownKeys = shown.map((index) => shots[index]?.id || previews?.[index] || String(index));
  const safeFocus = Math.min(focusedIndex, Math.max(0, shownPhotos.length - 1));
  const photo = shownPhotos[safeFocus] || shownPhotos[0];
  const groups =
    result?.groups?.length > 0
      ? result.groups
      : [
          {
            group_id: photo?.group_id || "1",
            label: result?.set_id || "Current set",
            missing_views: result?.missing_views || [],
          },
        ];
  const listedGroups =
    filter === "all"
      ? groups
      : filter === "none"
        ? [{ group_id: "none", label: "Unassigned", missing_views: [] }]
        : groups.filter((group) => String(group.group_id) === String(filter));
  const activeGroupId = photo?.group_id || listedGroups[0]?.group_id || groups[0].group_id;
  const analysisReady = Boolean(result?.photos?.some((item) => item?.status));
  const singlePhoto = shots.length === 1;
  const canAddSingle = singlePhoto && assignedGroupId(shots[0]) == null;
  const addLabel = addToSetLabel(storedSets, canAddSingle ? 1 : 0, addOpen);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
        directionalLockEnabled
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {analysisReady && !singlePhoto ? (
          <Pressable
            onPress={() => setOverviewOpen((current) => !current)}
            style={[styles.checklist, !overviewOpen && styles.checklistClosed]}
            accessibilityRole="button"
            accessibilityState={{ expanded: overviewOpen }}
            accessibilityLabel="Set overview"
          >
            <View style={styles.checklistHead}>
              <Text style={styles.checklistCompact} numberOfLines={overviewOpen ? undefined : 1}>
                {overviewLine(listedGroups, result?.set_id, analysisReady)}
              </Text>
              <Text style={styles.checklistChev}>{overviewOpen ? "▴" : "▾"}</Text>
            </View>
            {overviewOpen
              ? listedGroups.map((group) => {
                  const missing = group.missing_views || [];
                  const active = listedGroups.length === 1 || group.group_id === activeGroupId;
                  return (
                    <View key={group.group_id} style={[styles.groupBlock, !active && styles.groupDim]}>
                      <Text style={styles.kicker}>
                        {listedGroups.length > 1 || (filter === "all" && groups.length > 1)
                          ? group.label
                          : result?.set_id || group.label || "Current set"}
                      </Text>
                      <Text style={styles.checklistTitle}>
                        {missing.length ? `Missing ${missing.map(viewLabel).join(", ")}` : "All three required views are present"}
                      </Text>
                    </View>
                  );
                })
              : null}
            {overviewOpen ? (
              <Text style={styles.checklistBody}>
                {listedGroups.length > 1
                  ? listedGroups.every((group) => /^\d+$/.test(String(group.group_id)))
                    ? "Each set has its own three-view checklist. A retake is a photo that is here but not usable."
                    : "Each device has its own three-view checklist. A retake is a photo that is here but not usable."
                  : "A missing view means no photo was assigned to it. A retake is a photo that is here but not usable."}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {sets.length > 0 && !singlePhoto ? (
          <SetFilterBar
            filter={filter}
            sets={sets}
            includeUnassigned={false}
            onChange={setFilter}
          />
        ) : null}
        <View style={styles.rollerBlock}>
          <PhotoCarousel
            key={`roller-${filter}`}
            photos={shownPhotos}
            previews={shownPreviews}
            itemKeys={shownKeys}
            initialIndex={safeFocus}
            onFocus={onFocus}
            onHoldCenter={openStorage}
          />
          <PhotoDetails photo={photo} groupLabel="" shot={shots[shown[safeFocus]] || shots[0]} />
        </View>
        {error ? (
          <View style={styles.inlineError}>
            <Text style={styles.error}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.retry, pressed && styles.buttonPressed]}
              onPress={() => {
                setError("");
                setRetryTick((tick) => tick + 1);
              }}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      {canAddSingle ? (
        <Pressable
          ref={addButtonRef}
          collapsable={false}
          style={({ pressed }) => [styles.addSet, pressed && styles.buttonPressed]}
          onPress={openAddMenu}
          accessibilityRole="button"
          accessibilityState={{ expanded: addOpen }}
          accessibilityLabel="Add to set"
        >
          <Text style={styles.addSetText}>{addLabel}</Text>
        </Pressable>
      ) : null}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.addBackdrop} onPress={() => setAddOpen(false)}>
          <View
            style={[
              styles.addMenu,
              {
                top: addAnchor.y,
                left: addAnchor.x,
                width: Math.min(240, Math.max(addAnchor.w, 160)),
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <ScrollView style={styles.addMenuScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {storedSets.map((number) => (
                <Pressable
                  key={String(number)}
                  onPress={() => addSingleToSet(number)}
                  style={styles.addOption}
                  accessibilityRole="button"
                  accessibilityLabel={`Set ${number}`}
                >
                  <Text style={styles.addOptionText}>{`Set ${number}`}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => addSingleToSet(null)}
                style={styles.addOption}
                accessibilityRole="button"
                accessibilityLabel="New set"
              >
                <Text style={styles.addOptionText}>New set</Text>
              </Pressable>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => navigation.navigate("Camera")}
      >
        <Text style={styles.buttonText}>Back to camera</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: theme.background },
  page: { flex: 1 },
  pageContent: { paddingBottom: 8, flexGrow: 1 },
  checklist: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 10,
    padding: 16,
    backgroundColor: theme.surfaceTint,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
  },
  checklistClosed: { paddingHorizontal: 12, paddingVertical: 10 },
  checklistHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  checklistCompact: { flex: 1, color: theme.ink, fontSize: 15, fontWeight: "600" },
  checklistChev: { color: theme.accent, fontWeight: "700", fontSize: 14 },
  groupBlock: { marginTop: 10, marginBottom: 8 },
  groupDim: { opacity: 0.45 },
  kicker: { color: theme.accent, fontSize: 13, fontWeight: "600" },
  checklistTitle: { fontSize: 18, fontWeight: "600", color: theme.ink, marginTop: 4 },
  checklistBody: { color: theme.muted, marginTop: 4, lineHeight: 20, fontSize: 14, fontWeight: "500" },
  rollerBlock: { width: "100%" },
  stage: { width: "100%", overflow: "visible" },
  photo: { width: "100%", height: "100%" },
  details: { marginHorizontal: 16, marginTop: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  progressCard: { borderLeftColor: theme.accent, backgroundColor: theme.surfaceTint },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressText: { color: theme.ink, fontSize: 16, fontWeight: "600" },
  inlineError: { marginHorizontal: 16, marginTop: 10, marginBottom: 4 },
  retry: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: { color: "#fff", fontWeight: "700" },
  detailCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderLeftWidth: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { color: "#fff", fontWeight: "700" },
  setBeside: { color: theme.ink, fontWeight: "700", fontSize: 16 },
  setBelow: { marginTop: 8 },
  viewBlock: { marginTop: 12 },
  viewName: { fontSize: 22, fontWeight: "700", color: theme.ink, textTransform: "capitalize" },
  problemBlock: {
    marginTop: 10,
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  solutionBlock: {
    marginTop: 10,
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  blockKicker: { fontSize: 13, fontWeight: "700", color: theme.ink },
  blockBody: { marginTop: 4, fontSize: 16, lineHeight: 22, fontWeight: "500", color: theme.ink },
  button: {
    margin: 16,
    backgroundColor: theme.accent,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: "center",
  },
  addSet: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: theme.surface,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.accent,
  },
  addSetText: { color: theme.accent, fontWeight: "700" },
  addBackdrop: { flex: 1, backgroundColor: "rgba(23, 50, 77, 0.18)" },
  addMenu: {
    position: "absolute",
    maxHeight: 240,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#17324d",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  addMenuScroll: { maxHeight: 240 },
  addOption: { paddingHorizontal: 14, paddingVertical: 12 },
  addOptionText: { color: theme.ink, fontWeight: "600", fontSize: 14 },
  buttonPressed: { opacity: 0.85, backgroundColor: theme.accentPressed },
  buttonText: { color: "#fff", fontWeight: "700" },
  error: { fontSize: 18, fontWeight: "700", textAlign: "center", color: theme.ink },
  hint: { color: theme.muted, textAlign: "center", marginTop: 8, lineHeight: 20, fontSize: 15, fontWeight: "500" },
});
