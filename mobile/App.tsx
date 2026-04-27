import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView, Alert, Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";

const SERVER_URL = "http://localhost:3000";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "voice" | "wearable">("dashboard");
  const [pushToken, setPushToken] = useState<string>("");
  const [deviceName, setDeviceName] = useState(Device.modelName || "Mobile Device");
  const [voiceCommand, setVoiceCommand] = useState("Buy AAPL at market");
  const [voiceResult, setVoiceResult] = useState<string>("");
  const [watchSummary, setWatchSummary] = useState<any>(null);

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        setPushToken(token);
      }
    });
  }, []);

  async function registerForPushNotificationsAsync() {
    if (!Device.isDevice) {
      Alert.alert("Push notifications require a physical device.");
      return "";
    }
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      Alert.alert("Permission not granted for push notifications.");
      return "";
    }
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    try {
      await fetch(`${SERVER_URL}/api/mobile/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, platform: Platform.OS, deviceName }),
      });
    } catch (error) {
      console.warn("Could not register push token", error);
    }
    return token;
  }

  async function submitVoiceCommand() {
    try {
      const response = await fetch(`${SERVER_URL}/api/mobile/voice-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: voiceCommand }),
      });
      const data = await response.json();
      setVoiceResult(data.message || "No response from server.");
    } catch (error) {
      setVoiceResult("Error sending voice command.");
    }
  }

  async function fetchWatchSummary() {
    try {
      const response = await fetch(`${SERVER_URL}/api/mobile/watch-summary`);
      const data = await response.json();
      setWatchSummary(data);
      setActiveTab("wearable");
    } catch (error) {
      Alert.alert("Unable to load watch summary.");
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trading Buddy Mobile</Text>
        <Text style={styles.headerSubtitle}>Native mobile experience for trading on the go</Text>
      </View>

      <View style={styles.tabBar}>
        {[
          { key: "dashboard", label: "Dashboard" },
          { key: "voice", label: "Voice Command" },
          { key: "wearable", label: "Wearable" },
        ].map((tab) => (
          <TouchableOpacity key={tab.key} style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]} onPress={() => setActiveTab(tab.key as any)}>
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {activeTab === "dashboard" && (
          <View>
            <Text style={styles.sectionTitle}>Live alerts, quick trades, and push notifications</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Push Notifications</Text>
              <Text style={styles.cardText}>Push token:</Text>
              <Text style={styles.monoText}>{pushToken || "Not registered"}</Text>
              <Text style={styles.cardText}>Device: {deviceName}</Text>
              <TouchableOpacity style={styles.actionButton} onPress={fetchWatchSummary}>
                <Text style={styles.actionButtonText}>Refresh Watch Summary</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Quick Actions</Text>
              <TouchableOpacity style={styles.actionButton} onPress={() => setActiveTab("voice")}>Use Voice Command</TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={() => setActiveTab("wearable")}>Open Wearable Preview</TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === "voice" && (
          <View>
            <Text style={styles.sectionTitle}>Hands-free Trading</Text>
            <Text style={styles.cardText}>Tap submit to dispatch a voice-enabled intent for buy/sell, performance, or portfolio summary.</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.textInput}
                value={voiceCommand}
                onChangeText={setVoiceCommand}
                placeholder="Buy AAPL at market"
                placeholderTextColor="#94a3b8"
                multiline
              />
              <TouchableOpacity style={styles.actionButton} onPress={submitVoiceCommand}>
                <Text style={styles.actionButtonText}>Submit Voice Command</Text>
              </TouchableOpacity>
              {voiceResult ? <Text style={styles.cardText}>{voiceResult}</Text> : null}
            </View>
          </View>
        )}

        {activeTab === "wearable" && (
          <View>
            <Text style={styles.sectionTitle}>Wearable Snapshot</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Quick P&L Watch Data</Text>
              {watchSummary ? (
                <View>
                  <Text style={styles.cardText}>Total Unrealized P&L: {formatCurrency(watchSummary.totalUnrealized)}</Text>
                  <Text style={styles.cardText}>Total Exposure: {formatCurrency(watchSummary.totalExposure)}</Text>
                  {watchSummary.positions?.map((position: any) => (
                    <View key={position.symbol} style={styles.positionRow}>
                      <Text style={styles.positionSymbol}>{position.symbol}</Text>
                      <Text style={styles.positionValue}>{formatCurrency(position.unrealizedPnl)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.cardText}>Press refresh to load wearable summary.</Text>
              )}
            </View>
            <Text style={styles.note}>Apple Watch complications and Siri / Google Assistant integration are available through native bridge setup and can be wired to this watch summary endpoint.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617", paddingTop: 40 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { color: "#f8fafc", fontSize: 24, fontWeight: "800" },
  headerSubtitle: { color: "#94a3b8", marginTop: 6 },
  tabBar: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 10, paddingHorizontal: 10 },
  tabButton: { borderRadius: 9999, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "#0f172a" },
  tabButtonActive: { backgroundColor: "#0ea5e9" },
  tabLabel: { color: "#cbd5e1", fontSize: 13, fontWeight: "600" },
  tabLabelActive: { color: "#ffffff" },
  content: { padding: 20, paddingBottom: 60 },
  sectionTitle: { color: "#e2e8f0", fontSize: 18, fontWeight: "700", marginBottom: 12 },
  card: { backgroundColor: "#0f172a", borderRadius: 20, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: "#334155" },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 10 },
  cardText: { color: "#94a3b8", marginBottom: 8, lineHeight: 20 },
  monoText: { color: "#e2e8f0", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginBottom: 12 },
  textInput: { backgroundColor: "#08152d", color: "#f8fafc", borderRadius: 14, padding: 14, minHeight: 90, textAlignVertical: "top", marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  actionButton: { backgroundColor: "#38bdf8", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  actionButtonText: { color: "#0f172a", fontWeight: "700" },
  positionRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomColor: "#1e293b", borderBottomWidth: 1 },
  positionSymbol: { color: "#e2e8f0", fontWeight: "700" },
  positionValue: { color: "#7dd3fc", fontWeight: "700" },
  note: { color: "#94a3b8", fontSize: 13, marginTop: 10 },
});
