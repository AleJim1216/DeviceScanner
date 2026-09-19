import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { assignUploadViews } from "../src/carouselLayout";
import { cameraSetNumber, clearCameraSession, currentCameraSet } from "../src/cameraSession";
import { assignedShots, nextScreen, removeFromSets, shotsInSet } from "../src/grouping";
import { appendCaptured, loadPersistedShots, persistShots } from "../src/photoStore";
import { sessionShots } from "../src/sessionShots";
import { theme } from "../src/theme";

const VIEWS = [
  { id: "front", label: "Front" },
  { id: "rear_ports", label: "Rear" },
  { id: "label", label: "Label" },
];
const VIEW_IDS = VIEWS.map((item) => item.id);

function sessionCount(shots) {
  const setNumber = currentCameraSet();
  return setNumber == null ? 0 : shotsInSet(shots, setNumber).length;
}

export default function CameraScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [view, setView] = useState("front");
  const [shots, setShots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadPersistedShots().then(setShots);
  }, []);

  useEffect(() => {
    if (route.params?.shots?.length) {
      persistShots(route.params.shots);
      setShots(route.params.shots);
    }
  }, [route.params]);

  useFocusEffect(
    useCallback(() => {
      setShots(sessionShots());
    }, [])
  );

  function openStorage(next) {
    navigation.navigate("Photos", {
      shots: next?.length ? next : sessionShots(),
      filter: "all",
    });
  }

  function openSessionStorage() {
    const setNumber = currentCameraSet();
    if (setNumber == null) {
      setError("Take a photo first.");
      return;
    }
    setError("");
    navigation.navigate("Photos", {
      shots: shots.length ? shots : sessionShots(),
      filter: setNumber,
    });
  }

  function openAnalysis(rows, scope) {
    if (!rows.length) {
      return;
    }
    navigation.navigate("Analysis", {
      shots: rows,
      previews: rows.map((shot) => shot.uri),
      result: null,
      scope,
    });
  }

  async function openSessionAnalysis() {
    const setNumber = currentCameraSet();
    const rows = setNumber == null ? [] : shotsInSet(shots, setNumber);
    if (!rows.length) {
      setError("Take a photo first.");
      return;
    }
    setError("");
    if (rows.length === 1) {
      const shot = rows[0];
      const index = shots.findIndex((item) => item.id === shot.id || item.uri === shot.uri);
      const next = index >= 0 ? removeFromSets(shots, [index]) : shots;
      const lone = { ...shot, groupId: null };
      await persistShots(next);
      setShots(next);
      clearCameraSession();
      openAnalysis([lone], { type: "single", shotIds: shot.id ? [shot.id] : [] });
      return;
    }
    clearCameraSession();
    openAnalysis(rows, { type: "session", setNumber });
  }

  function openStorageAnalysis() {
    const rows = assignedShots(shots);
    if (!rows.length) {
      setError("Group photos into a set in Storage first.");
      return;
    }
    setError("");
    openAnalysis(rows, { type: "storage" });
  }

  function promptAnalyze() {
    Alert.alert("Analyze", "Check photos from this session or from Storage?", [
      { text: "This session", onPress: openSessionAnalysis },
      { text: "Storage", onPress: openStorageAnalysis },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function takePhoto() {
    if (!cameraRef.current || busy) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      const next = await appendCaptured(shots, [
        {
          uri: photo.uri,
          view,
          name: `camera-${shots.length + 1}.jpg`,
          width: photo.width,
          height: photo.height,
          source: "camera",
          groupId: cameraSetNumber(shots),
        },
      ]);
      setShots(next);
    } catch (err) {
      setError(err.message || "The camera did not return a photo.");
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto() {
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to upload.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 0,
      orderedSelection: true,
    });
    if (picked.canceled || !picked.assets?.length) {
      return;
    }
    const views = assignUploadViews(view, picked.assets.length, VIEW_IDS);
    const added = picked.assets.map((asset, offset) => ({
      uri: asset.uri,
      view: views[offset],
      name: asset.fileName || `upload-${shots.length + offset + 1}.jpg`,
      width: asset.width,
      height: asset.height,
      source: "library",
      groupId: null,
    }));
    const next = await appendCaptured(shots, added);
    setShots(next);
    if (nextScreen(next, "library") === "Photos") {
      openStorage(next);
    }
  }

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <StatusBar style="dark" />
        <Text style={styles.permissionTitle}>Camera access is required</Text>
        <Text style={styles.permissionBody}>
          ScanE uses the camera to photograph a device. You can still upload photos after allowing the camera.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          onPress={requestPermission}
        >
          <Text style={styles.primaryText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  const photosInSession = sessionCount(shots);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <Pressable
        style={({ pressed }) => [
          styles.circle,
          styles.circleUpload,
          styles.profile,
          { top: insets.top + 12 },
          pressed && styles.chipPressed,
        ]}
        onPress={() => navigation.navigate("Profile")}
        accessibilityRole="button"
        accessibilityLabel="Profile"
      >
        <Ionicons name="person-outline" size={24} color="#fff" />
      </Pressable>
      <View style={styles.bar}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.views}>
          {VIEWS.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [
                styles.viewChip,
                view === item.id && styles.viewChipOn,
                pressed && styles.chipPressed,
              ]}
              onPress={() => setView(item.id)}
            >
              <Text style={[styles.viewText, view === item.id && styles.viewTextOn]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.controls}>
          <View style={styles.sideCluster}>
            <Pressable
              style={({ pressed }) => [styles.circle, styles.circleUpload, pressed && styles.chipPressed]}
              onPress={pickPhoto}
              accessibilityRole="button"
              accessibilityLabel="Upload"
            >
              <Ionicons name="cloud-upload-outline" size={24} color="#fff" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.circle, styles.circleUpload, pressed && styles.chipPressed]}
              onPress={() => openStorage(shots)}
              accessibilityRole="button"
              accessibilityLabel="Storage"
            >
              <Ionicons name="images-outline" size={24} color="#fff" />
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [styles.shutter, pressed && styles.chipPressed]}
            onPress={takePhoto}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
          >
            {busy ? <ActivityIndicator color={theme.ink} /> : <View style={styles.shutterCore} />}
          </Pressable>
          <View style={styles.sideCluster}>
            <Pressable
              style={({ pressed }) => [styles.circle, styles.circleUpload, pressed && styles.chipPressed]}
              onPress={openSessionStorage}
              accessibilityRole="button"
              accessibilityLabel="This session"
            >
              <Ionicons name="albums-outline" size={24} color="#fff" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.circle, styles.circleUpload, pressed && styles.chipPressed]}
              onPress={promptAnalyze}
              accessibilityRole="button"
              accessibilityLabel="Analyze"
            >
              <Ionicons name="search" size={24} color="#fff" />
            </Pressable>
          </View>
        </View>
        <Text style={styles.count}>{`${photosInSession} photos`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  chipPressed: { opacity: 0.85 },
  error: { color: theme.status.retake.tint, marginBottom: 8, textAlign: "center" },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 28,
    paddingTop: 12,
    backgroundColor: theme.camera.bar,
    alignItems: "center",
  },
  views: { flexDirection: "row", gap: 10, marginBottom: 12 },
  viewChip: {
    borderWidth: 1,
    borderColor: "#fff",
    backgroundColor: theme.camera.viewIdle,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  viewChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  viewText: { color: "#fff", fontWeight: "600" },
  viewTextOn: { color: "#fff" },
  controls: {
    width: "100%",
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sideCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 116,
  },
  circle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  circleUpload: { backgroundColor: theme.camera.chipUpload },
  profile: { position: "absolute", right: 20, zIndex: 2 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff",
    borderWidth: 4,
    borderColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: theme.ink,
  },
  count: { color: theme.border, marginTop: 8, fontSize: 14, fontWeight: "500" },
  permission: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: theme.background },
  permissionTitle: { color: theme.ink, fontSize: 22, fontWeight: "700" },
  permissionBody: { color: theme.muted, marginTop: 8, marginBottom: 20, lineHeight: 22 },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryPressed: { opacity: 0.85, backgroundColor: theme.accentPressed },
  primaryText: { color: "#fff", fontWeight: "700" },
});
