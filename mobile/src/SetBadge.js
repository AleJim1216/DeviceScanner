import { StyleSheet, Text, View } from "react-native";
import { badgeLabel, setColor } from "./grouping";
import { theme } from "./theme";

export default function SetBadge({ groupId }) {
  const label = badgeLabel(groupId);
  if (!label) {
    return null;
  }
  return (
    <View style={[styles.badge, { backgroundColor: setColor(groupId, theme.setColors) }]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  text: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
