import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { analyzeSet, fetchSets } from "../src/api";

const VIEWS = [
  { id: "front", label: "Front" },
  { id: "rear_ports", label: "Rear" },
  { id: "label", label: "Label" },
];

export default function CameraScreen({ navigation, route }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [view, setView] = useState("front");
  const [shots, setShots] = useState([]);
  const [sets, setSets] = useState([]);
  const [showSets, setShowSets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (route.params?.shots) {
      setShots(route.params.shots);
    }
  }, [route.params]);

  async function takePhoto() {
    if (!cameraRef.current || busy) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      const next = [
        ...shots,
        { uri: photo.uri, view, name: `camera-${shots.length + 1}.jpg` },
      ];
      setShots(next);
      navigation.navigate("Analysis", {
        shots: next,
        previews: next.map((shot) => shot.uri),
        result: null,
      });
    } catch (err) {
      setError(err.message || "The camera did not return a photo.");
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto() {
    setError("");
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (picked.canceled) {
      return;
    }
    const asset = picked.assets[0];
    const next = [
      ...shots,
      {
        uri: asset.uri,
        view,
        name: asset.fileName || `upload-${shots.length + 1}.jpg`,
      },
    ];
    setShots(next);
    navigation.navigate("Analysis", {
      shots: next,
      previews: next.map((shot) => shot.uri),
      result: null,
    });
  }

  async function loadSets() {
    setError("");
    setBusy(true);
    try {
      const rows = await fetchSets();
      setSets(rows);
      setShowSets(true);
    } catch (err) {
      setError(err.message || "Could not load the practice sets.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseSet(setId) {
    setError("");
    setBusy(true);
    try {
      const result = await analyzeSet(setId);
      setShowSets(false);
      navigation.navigate("Analysis", { result, previews: null, shots: [] });
    } catch (err) {
      setError(err.message || "That set could not be analyzed.");
    } finally {
      setBusy(false);
    }
  }

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <Text style={styles.permissionTitle}>Camera access is required</Text>
        <Text style={styles.permissionBody}>
          DeviceScanner uses the camera to photograph a device. You can still import a practice set after allowing the camera.
        </Text>
        <Pressable style={styles.primary} onPress={requestPermission}>
          <Text style={styles.primaryText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.top}>
        <View style={styles.topRow}>
          <Pressable style={styles.chip} onPress={pickPhoto}>
            <Text style={styles.chipText}>Upload</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={loadSets}>
            <Text style={styles.chipText}>Practice sets</Text>
          </Pressable>
          <Pressable
            style={styles.chip}
            onPress={() => {
              setShots([]);
              setError("");
            }}
          >
            <Text style={styles.chipText}>Clear</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {showSets ? (
        <ScrollView style={styles.setList}>
          {sets.map((item) => (
            <Pressable key={item.set_id} style={styles.setRow} onPress={() => chooseSet(item.set_id)}>
              <Text style={styles.setTitle}>
                {item.set_id} · {item.device_id} · {item.count} photos
              </Text>
              <Text style={styles.setMeta}>
                {item.missing_views.length
                  ? `Supplied without ${item.missing_views.join(", ")}`
                  : "All three views are in this set"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.bar}>
        <View style={styles.views}>
          {VIEWS.map((item) => (
            <Pressable
              key={item.id}
              style={[styles.viewChip, view === item.id && styles.viewChipOn]}
              onPress={() => setView(item.id)}
            >
              <Text style={[styles.viewText, view === item.id && styles.viewTextOn]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.shutter} onPress={takePhoto} disabled={busy}>
          {busy ? <ActivityIndicator color="#111" /> : <View style={styles.shutterCore} />}
        </Pressable>
        <Text style={styles.count}>{shots.length} in this set</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  top: { position: "absolute", top: 48, left: 16, right: 16 },
  topRow: { flexDirection: "row", gap: 8 },
  chip: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { color: "#fff", fontSize: 14 },
  error: { color: "#ffb4a8", marginTop: 8 },
  setList: {
    position: "absolute",
    top: 150,
    left: 16,
    right: 16,
    maxHeight: 280,
    backgroundColor: "#111820",
    borderRadius: 12,
  },
  setRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#243040" },
  setTitle: { color: "#fff", fontWeight: "600" },
  setMeta: { color: "#b7c0ca", marginTop: 2 },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 28,
    paddingTop: 12,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
  },
  views: { flexDirection: "row", gap: 8, marginBottom: 12 },
  viewChip: {
    borderWidth: 1,
    borderColor: "#8d98a3",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  viewChipOn: { backgroundColor: "#fff", borderColor: "#fff" },
  viewText: { color: "#fff" },
  viewTextOn: { color: "#111" },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "#111",
  },
  count: { color: "#d5dbe1", marginTop: 8 },
  permission: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#101418" },
  permissionTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  permissionBody: { color: "#c5ced6", marginTop: 8, marginBottom: 20, lineHeight: 22 },
  primary: { backgroundColor: "#fff", borderRadius: 10, padding: 14, alignItems: "center" },
  primaryText: { fontWeight: "700" },
});
