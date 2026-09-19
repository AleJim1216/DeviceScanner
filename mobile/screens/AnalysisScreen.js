import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { analyzeShots, imageUrl } from "../src/api";

const WIDTH = Dimensions.get("window").width;

const VIEW_LABEL = {
  front: "front",
  rear_ports: "rear",
  label: "label",
};

function viewLabel(name) {
  return VIEW_LABEL[name] || name.replaceAll("_", " ");
}

const STATUS = {
  usable: { label: "Usable", color: "#1f7a4d" },
  retake: { label: "Retake", color: "#b42318" },
  needs_review: { label: "Needs review", color: "#9a6700" },
};

export default function AnalysisScreen({ navigation, route }) {
  const { result: incoming, previews, shots } = route.params;
  const [result, setResult] = useState(incoming);
  const [error, setError] = useState("");

  useEffect(() => {
    if (incoming || !shots?.length) {
      return;
    }
    let cancelled = false;
    analyzeShots(shots)
      .then((data) => {
        if (!cancelled) {
          setResult(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError("Could not check this photo. Leave the computer running and try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [incoming, shots]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Could not check this photo. Leave the computer running and try again.</Text>
        <Pressable style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>Back to camera</Text>
        </Pressable>
      </View>
    );
  }

  if (!result) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#111" />
        <Text style={styles.hint}>Checking this set</Text>
      </View>
    );
  }

  const missing = result.missing_views || [];

  return (
    <View style={styles.screen}>
      <View style={styles.checklist}>
        <Text style={styles.kicker}>{result.set_id || "Current set"}</Text>
        <Text style={styles.checklistTitle}>
          {missing.length ? `Missing ${missing.map(viewLabel).join(", ")}` : "All three required views are present"}
        </Text>
        <Text style={styles.checklistBody}>
          A missing view means no photo was assigned to it. A retake is a photo that is here but not usable.
        </Text>
      </View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
        {result.photos.map((photo, index) => {
          const tone = STATUS[photo.status] || STATUS.needs_review;
          const uri = previews?.[index] || imageUrl(photo.image_id);
          return (
            <View key={`${photo.image_id}-${index}`} style={[styles.card, { width: WIDTH }]}>
              <Image source={{ uri }} style={styles.photo} resizeMode="contain" />
              <View style={[styles.badge, { backgroundColor: tone.color }]}>
                <Text style={styles.badgeText}>{tone.label}</Text>
              </View>
              <Text style={styles.viewName}>{viewLabel(photo.intended_view)}</Text>
              <Text style={styles.issues}>
                {photo.issue_codes.length ? photo.issue_codes.join(", ") : "No defect code"}
              </Text>
              {photo.guidance ? <Text style={styles.guidance}>{photo.guidance}</Text> : null}
              {photo.reason ? <Text style={styles.reason}>{photo.reason}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate("Camera", { shots: shots || [] })}
      >
        <Text style={styles.buttonText}>Back to camera</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f1ea" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#f4f1ea" },
  checklist: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  kicker: { color: "#5c6770", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 },
  checklistTitle: { fontSize: 22, fontWeight: "700", color: "#1c1915", marginTop: 4 },
  checklistBody: { color: "#5c564e", marginTop: 4, lineHeight: 20 },
  card: { paddingHorizontal: 20, paddingBottom: 12 },
  photo: { width: "100%", height: 280, backgroundColor: "#e7e1d6", borderRadius: 16 },
  badge: { alignSelf: "flex-start", marginTop: 12, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: "#fff", fontWeight: "700" },
  viewName: { marginTop: 8, fontSize: 16, fontWeight: "600", textTransform: "capitalize" },
  issues: { color: "#5c564e", marginTop: 4 },
  guidance: { marginTop: 10, fontSize: 18, lineHeight: 26, color: "#1c1915" },
  reason: { marginTop: 6, color: "#5c564e", lineHeight: 20 },
  button: { margin: 16, backgroundColor: "#1c1915", borderRadius: 12, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700" },
  error: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  hint: { color: "#5c564e", textAlign: "center", marginTop: 8, lineHeight: 20 },
});
