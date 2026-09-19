import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { filterItems, filterLabel } from "./grouping";
import { theme } from "./theme";

export default function SetFilterBar({ filter, sets, onChange, includeUnassigned = false }) {
  const items = filterItems(sets, includeUnassigned);
  const current = filterLabel(filter, sets, includeUnassigned);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 16, y: 72, w: 180 });
  const buttonRef = useRef(null);

  function openMenu() {
    const node = buttonRef.current;
    if (!node?.measureInWindow) {
      setOpen(true);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setAnchor({
        x: Math.max(16, x),
        y: y + height + 4,
        w: Math.max(width, 180),
      });
      setOpen(true);
    });
  }

  function choose(id) {
    onChange(id);
    setOpen(false);
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        ref={buttonRef}
        collapsable={false}
        onPress={() => (open ? setOpen(false) : openMenu())}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Filter ${current}`}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {current}
        </Text>
        <Text style={styles.chev}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View
            style={[
              styles.menu,
              {
                top: anchor.y,
                left: anchor.x,
                width: Math.min(240, Math.max(anchor.w, 160)),
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <ScrollView style={styles.menuScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {items.map((item) => {
                const on = String(filter) === String(item.id);
                return (
                  <Pressable
                    key={String(item.id)}
                    onPress={() => choose(item.id)}
                    style={[styles.option, on && styles.optionOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={item.label}
                  >
                    <Text style={[styles.optionText, on && styles.optionTextOn]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 0, flexShrink: 0, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4, alignSelf: "flex-start" },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 220,
  },
  triggerText: { color: theme.ink, fontWeight: "600", fontSize: 13, flexShrink: 1 },
  chev: { color: theme.muted, fontWeight: "700", fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(23, 50, 77, 0.18)" },
  menu: {
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
  menuScroll: { maxHeight: 240 },
  option: { paddingHorizontal: 14, paddingVertical: 12 },
  optionOn: { backgroundColor: theme.surfaceTint },
  optionText: { color: theme.ink, fontWeight: "600", fontSize: 14 },
  optionTextOn: { color: theme.accent },
});
