import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { signIn } from "../src/api";
import { syncLibrary } from "../src/dashboardSync";
import { loadProfile, saveProfile } from "../src/profile";
import { theme } from "../src/theme";

export default function ProfileScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadProfile().then(setSession);
    }, [])
  );

  async function onSignIn() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await signIn(username.trim(), password);
      await saveProfile(next);
      setSession(next);
      setPassword("");
      const result = await syncLibrary();
      setNote(`Synced ${result.count} photo${result.count === 1 ? "" : "s"} to the dashboard.`);
    } catch (err) {
      setError(err.message || "Could not sign in. Leave the computer running and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    await saveProfile(null);
    setSession(null);
    setPassword("");
    setError("");
    setNote("");
  }

  async function onSync() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await syncLibrary();
      setNote(`Synced ${result.count} photo${result.count === 1 ? "" : "s"} to the dashboard.`);
    } catch (err) {
      setError(err.message || "Could not sync. Leave the computer running and try again.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = username.trim() && password.length >= 4 && !busy;

  if (session?.username) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.checklist}>
          <Text style={styles.kicker}>Signed in</Text>
          <Text style={styles.checklistTitle}>{session.username}</Text>
          <Text style={styles.checklistBody}>
            This phone is signed in as this username. Photos save to the web dashboard automatically.
          </Text>
          {note ? <Text style={styles.checklistBody}>{note}</Text> : null}
        </View>
        <Pressable
          style={({ pressed }) => [styles.primary, styles.sync, pressed && styles.primaryPressed]}
          onPress={onSync}
          disabled={busy}
        >
          <Text style={styles.primaryText}>{busy ? "Syncing…" : "Sync now"}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]} onPress={onSignOut}>
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.permission}>
      <StatusBar style="dark" />
      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.field}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Username"
        placeholderTextColor={theme.muted}
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.field}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        placeholderTextColor={theme.muted}
      />
      <Pressable
        style={({ pressed }) => [styles.primary, !canSubmit && styles.primaryOff, pressed && canSubmit && styles.primaryPressed]}
        onPress={onSignIn}
        disabled={!canSubmit}
      >
        <Text style={[styles.primaryText, !canSubmit && styles.primaryTextOff]}>Sign in</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background, paddingTop: 12 },
  permission: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: theme.background },
  label: { color: theme.muted, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  field: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: theme.ink,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
  },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 10,
  },
  primaryPressed: { opacity: 0.85, backgroundColor: theme.accentPressed },
  sync: { marginHorizontal: 16, marginBottom: 10 },
  primaryOff: { backgroundColor: theme.border },
  primaryText: { color: "#fff", fontWeight: "700" },
  primaryTextOff: { color: theme.muted },
  error: { color: theme.status.retake.color, marginTop: 12, textAlign: "center", fontSize: 15, fontWeight: "500" },
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
  kicker: { color: theme.accent, fontSize: 13, fontWeight: "600" },
  checklistTitle: { fontSize: 18, fontWeight: "600", color: theme.ink, marginTop: 4 },
  checklistBody: { color: theme.muted, marginTop: 4, lineHeight: 20, fontSize: 14, fontWeight: "500" },
  secondary: {
    marginHorizontal: 16,
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
});
