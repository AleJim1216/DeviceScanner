import { StyleSheet, View } from "react-native";

export function ActionBar({ children, style }) {
  return <View style={[styles.bar, style]}>{children}</View>;
}

export function ActionGroup({ children, style, full = false }) {
  return <View style={[styles.group, full && styles.groupRow, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "stretch",
    columnGap: 16,
    rowGap: 10,
  },
  group: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  groupRow: { flexBasis: "100%", width: "100%", alignItems: "stretch" },
});
