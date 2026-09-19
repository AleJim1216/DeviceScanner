import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gridCellSize } from "../src/carouselLayout";
import {
  addToSetLabel,
  assignSet,
  assignedGroupId,
  assignedShots,
  canAddToSet,
  canAnalyze,
  createSetNumber,
  removeFromSets,
  storageFilter,
  unassignedCopy,
  unassignedCount,
  usedSetNumbers,
  visibleIndexes,
} from "../src/grouping";
import { ActionBar, ActionGroup } from "../src/ActionBar";
import { clearPersisted, deletePersisted, loadPersistedShots, persistShots } from "../src/photoStore";
import { sessionShots } from "../src/sessionShots";
import SetBadge from "../src/SetBadge";
import SetFilterBar from "../src/SetFilterBar";
import { syncLibrary } from "../src/dashboardSync";
import { theme } from "../src/theme";

export default function GroupingScreen({ navigation, route }) {
  const incoming = route.params?.shots || sessionShots();
  const paramFilter = route.params?.filter;
  const [shots, setShots] = useState(incoming);
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState(() => storageFilter(paramFilter));
  const [addOpen, setAddOpen] = useState(false);
  const [addAnchor, setAddAnchor] = useState({ x: 16, y: 72, w: 180 });
  const addButtonRef = useRef(null);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { cellW, cellH, gap } = gridCellSize(window.width);
  const missing = unassignedCount(shots);
  const shown = visibleIndexes(shots, filter);
  const canCreate = selected.size > 0;
  const canRemove = [...selected].some((index) => assignedGroupId(shots[index]) != null);
  const sets = usedSetNumbers(shots);
  const canAdd = canAddToSet(selected.size, sets);
  const addLabel = addToSetLabel(sets, selected.size, addOpen);
  const allShownOn = Boolean(shown.length) && shown.every((index) => selected.has(index));

  useEffect(() => {
    if (!canAdd && addOpen) {
      setAddOpen(false);
    }
  }, [canAdd, addOpen]);

  useEffect(() => {
    if (paramFilter != null) {
      setFilter(storageFilter(paramFilter));
    }
    if (route.params?.shots?.length) {
      setShots(route.params.shots);
      setSelected(new Set());
    }
  }, [paramFilter, route.params]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (route.params?.shots?.length) {
        setShots(route.params.shots);
      }
      loadPersistedShots().then((stored) => {
        if (cancelled) {
          return;
        }
        if (stored?.length) {
          setShots(stored);
        } else if (route.params?.shots?.length) {
          setShots(route.params.shots);
        } else {
          setShots(sessionShots());
        }
      });
      return () => {
        cancelled = true;
      };
    }, [route.params])
  );

  async function commit(next) {
    await persistShots(next);
    setShots(next);
    syncLibrary();
  }

  function toggle(index) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  async function createSet() {
    if (!canCreate) {
      return;
    }
    await commit(assignSet(shots, [...selected], createSetNumber(shots, [...selected])));
    setSelected(new Set());
  }

  async function removeSet() {
    if (!canRemove) {
      return;
    }
    await commit(removeFromSets(shots, [...selected]));
    setSelected(new Set());
  }

  async function addToSet(setNumber) {
    if (!canAdd) {
      return;
    }
    setAddOpen(false);
    await commit(assignSet(shots, [...selected], setNumber));
    setSelected(new Set());
  }

  function openAddMenu() {
    if (!canAdd) {
      return;
    }
    if (sets.length === 1) {
      addToSet(sets[0]);
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
    node.measureInWindow((x, y, width, height) => {
      setAddAnchor({
        x: Math.max(16, x),
        y: y + height + 4,
        w: Math.max(width, 180),
      });
      setAddOpen(true);
    });
  }

  function selectAll() {
    if (!shown.length) {
      return;
    }
    if (allShownOn) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(shown));
  }

  function deleteAll() {
    if (!shots.length) {
      return;
    }
    Alert.alert("Delete all photos", "Remove every saved photo from the app?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete all",
        style: "destructive",
        onPress: async () => {
          await clearPersisted();
          setShots([]);
          setSelected(new Set());
          syncLibrary();
        },
      },
    ]);
  }

  function deleteSelected() {
    if (!selected.size) {
      return;
    }
    Alert.alert("Delete photos", `Remove ${selected.size} photo${selected.size === 1 ? "" : "s"} from the app?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const next = await deletePersisted(shots, [...selected]);
          setShots(next);
          setSelected(new Set());
          syncLibrary();
        },
      },
    ]);
  }

  function backToCamera() {
    persistShots(shots);
    navigation.navigate("Camera");
  }

  function openAnalysis() {
    const rows = assignedShots(shots);
    if (!canAnalyze(shots)) {
      Alert.alert("Analyze", "Group photos into a set first.");
      return;
    }
    persistShots(shots);
    navigation.navigate("Analysis", {
      shots: rows,
      previews: rows.map((shot) => shot.uri),
      result: null,
      scope: { type: "storage" },
    });
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <SetFilterBar filter={filter} sets={sets} includeUnassigned onChange={setFilter} />
      <ActionBar style={styles.toolbar}>
        <ActionGroup full>
          <Pressable
            style={({ pressed }) => [styles.tool, styles.toolGrow, !shown.length && styles.toolOff, pressed && shown.length && styles.buttonPressed]}
            onPress={selectAll}
            disabled={!shown.length}
            accessibilityRole="button"
            accessibilityState={{ disabled: !shown.length }}
            accessibilityLabel={allShownOn ? "Deselect" : "Select all"}
          >
            <Text style={styles.toolText} numberOfLines={1}>
              {allShownOn ? "Deselect" : "Select all"}
            </Text>
          </Pressable>
        </ActionGroup>
        <ActionGroup full>
          <Pressable
            style={({ pressed }) => [styles.tool, styles.toolGrow, !canCreate && styles.toolOff, pressed && canCreate && styles.buttonPressed]}
            onPress={createSet}
            disabled={!canCreate}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canCreate }}
            accessibilityLabel="Create Set"
          >
            <Text style={styles.toolText} numberOfLines={1}>
              {canCreate ? `Create Set (${selected.size})` : "Create Set"}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tool, styles.toolGrow, !canRemove && styles.toolOff, pressed && canRemove && styles.buttonPressed]}
            onPress={removeSet}
            disabled={!canRemove}
            accessibilityRole="button"
            accessibilityLabel="Remove from set"
          >
            <Text style={styles.toolText} numberOfLines={1}>
              Remove from set
            </Text>
          </Pressable>
        </ActionGroup>
        <ActionGroup full>
          <Pressable
            ref={addButtonRef}
            collapsable={false}
            style={({ pressed }) => [styles.tool, styles.toolGrow, !canAdd && styles.toolOff, pressed && canAdd && styles.buttonPressed]}
            onPress={openAddMenu}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAdd, expanded: addOpen }}
            accessibilityLabel="Add to set"
          >
            <Text style={styles.toolText} numberOfLines={1}>
              {addLabel}
            </Text>
          </Pressable>
        </ActionGroup>
        <ActionGroup full>
          <Pressable
            style={({ pressed }) => [
              styles.tool,
              styles.toolGrow,
              styles.delete,
              !selected.size && styles.toolOff,
              pressed && selected.size && styles.deletePressed,
            ]}
            onPress={deleteSelected}
            disabled={!selected.size}
            accessibilityRole="button"
            accessibilityLabel="Delete"
          >
            <Text style={styles.toolText} numberOfLines={1}>
              {selected.size ? `Delete (${selected.size})` : "Delete"}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.tool,
              styles.toolGrow,
              styles.delete,
              !shots.length && styles.toolOff,
              pressed && shots.length && styles.deletePressed,
            ]}
            onPress={deleteAll}
            disabled={!shots.length}
            accessibilityRole="button"
            accessibilityState={{ disabled: !shots.length }}
            accessibilityLabel="Delete all"
          >
            <Text style={styles.toolText} numberOfLines={1}>
              Delete all
            </Text>
          </Pressable>
        </ActionGroup>
      </ActionBar>
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
              {sets.map((number) => (
                <Pressable
                  key={String(number)}
                  onPress={() => addToSet(number)}
                  style={styles.addOption}
                  accessibilityRole="button"
                  accessibilityLabel={`Set ${number}`}
                >
                  <Text style={styles.addOptionText}>{`Set ${number}`}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      <ScrollView style={styles.grid} contentContainerStyle={styles.gridContent}>
        <View style={[styles.gridWrap, { width: window.width, columnGap: gap }]}>
          {shown.map((index) => {
            const shot = shots[index];
            const on = selected.has(index);
            return (
              <Pressable
                key={shot.id || `${shot.uri}-${index}`}
                onPress={() => toggle(index)}
                style={[styles.cell, { width: cellW, height: cellH, marginBottom: gap }, on && styles.cellSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={on ? "Selected photo" : "Photo"}
              >
                <Image source={{ uri: shot.uri }} style={{ width: cellW, height: cellH }} resizeMode="cover" />
                {on ? <View style={styles.cellWash} pointerEvents="none" /> : null}
                <SetBadge groupId={assignedGroupId(shot)} />
                {on ? (
                  <View style={styles.selectedMark} pointerEvents="none">
                    <Text style={styles.selectedMarkText}>✓</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Text style={styles.hint}>{shots.length ? unassignedCopy(missing) : "Upload photos to put them in a set."}</Text>
      <View style={[styles.actions, { marginBottom: 16 + insets.bottom }]}>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          onPress={backToCamera}
          accessibilityRole="button"
          accessibilityLabel="Back to camera"
        >
          <Text style={styles.secondaryText}>Back to camera</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.done, !canAnalyze(shots) && styles.doneOff, pressed && canAnalyze(shots) && styles.buttonPressed]}
          onPress={openAnalysis}
          disabled={!canAnalyze(shots)}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canAnalyze(shots) }}
          accessibilityLabel="Analyze"
        >
          <Text style={[styles.doneText, !canAnalyze(shots) && styles.doneTextOff]}>Analyze</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  toolbar: { marginHorizontal: 16, marginTop: 4, flexShrink: 0 },
  tool: {
    backgroundColor: theme.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  toolGrow: { flex: 1 },
  toolOff: { backgroundColor: theme.border },
  delete: { backgroundColor: theme.status.retake.color },
  deletePressed: { opacity: 0.85 },
  toolText: { color: "#fff", fontWeight: "700", fontSize: 13, textAlign: "center" },
  grid: { flex: 1, minHeight: 160, marginTop: 8 },
  gridContent: { flexGrow: 1, paddingBottom: 8 },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    paddingHorizontal: 16,
  },
  cell: {
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 3,
    borderColor: "transparent",
    flexShrink: 0,
  },
  cellSelected: { borderColor: theme.accent },
  cellWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26, 166, 160, 0.4)",
  },
  selectedMark: {
    position: "absolute",
    left: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedMarkText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  hint: { color: theme.muted, textAlign: "center", marginHorizontal: 16, marginTop: 8, fontSize: 14, fontWeight: "500", flexShrink: 0 },
  actions: { flexDirection: "row", gap: 10, marginHorizontal: 16, marginTop: 8, flexGrow: 0, flexShrink: 0 },
  secondary: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  secondaryPressed: { opacity: 0.85, backgroundColor: theme.surfaceTint },
  secondaryText: { color: theme.ink, fontWeight: "700" },
  done: {
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  doneOff: { backgroundColor: theme.border },
  doneText: { color: "#fff", fontWeight: "700" },
  doneTextOff: { color: theme.muted },
  buttonPressed: { opacity: 0.85, backgroundColor: theme.accentPressed },
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
});
