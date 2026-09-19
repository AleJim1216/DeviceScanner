import { Pressable } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import CameraScreen from "./screens/CameraScreen";
import AnalysisScreen from "./screens/AnalysisScreen";
import GroupingScreen from "./screens/GroupingScreen";
import ProfileScreen from "./screens/ProfileScreen";
import { theme } from "./src/theme";
import "./src/dashboardSync";

const Stack = createNativeStackNavigator();

const headerOptions = {
  headerStyle: { backgroundColor: theme.background },
  headerTintColor: theme.ink,
  headerShadowVisible: false,
  headerTitleStyle: { color: theme.ink, fontWeight: "600" },
};

function ProfileButton({ navigation }) {
  return (
    <Pressable
      onPress={() => navigation.navigate("Profile")}
      accessibilityRole="button"
      accessibilityLabel="Profile"
      style={{ paddingHorizontal: 8, paddingVertical: 8 }}
    >
      <Ionicons name="person-outline" size={24} color={theme.ink} />
    </Pressable>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Camera" component={CameraScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="Analysis"
            component={AnalysisScreen}
            options={{
              title: "Analysis",
              ...headerOptions,
            }}
          />
          <Stack.Screen
            name="Photos"
            component={GroupingScreen}
            options={({ navigation }) => ({
              title: "Storage",
              headerBackVisible: false,
              ...headerOptions,
              headerRight: () => <ProfileButton navigation={navigation} />,
            })}
          />
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{
              title: "Profile",
              ...headerOptions,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
