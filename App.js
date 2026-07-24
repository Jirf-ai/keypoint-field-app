// Kaicon Field — on-site daily capture (Franc's PRD v0.1 is the spec).
// Hand-rolled navigation (same pattern as the DD app): a screen stack in
// state, no navigation library. The first screen is capture, always.
import { useEffect, useState } from "react";
import { Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { makeT } from "./src/i18n";
import { todayStr } from "./src/schema";
import { getSettings, load, pendingCount } from "./src/store";
import AddItemScreen from "./src/screens/AddItemScreen";
import AddLaborScreen from "./src/screens/AddLaborScreen";
import AddPhotoScreen from "./src/screens/AddPhotoScreen";
import ChangeOrdersScreen from "./src/screens/ChangeOrdersScreen";
import ReviewScreen from "./src/screens/ReviewScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import TodayScreen from "./src/screens/TodayScreen";
import { colors } from "./src/theme";

const TITLES = {
  today: "today",
  item: "item",
  labor: "labor",
  photo: "photo",
  review: "review",
  cos: "changeOrders",
  settings: "settings",
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("today");
  const [lang, setLang] = useState("en");
  const [tick, setTick] = useState(0); // re-render after store writes

  const workDate = todayStr();
  const t = makeT(lang);

  useEffect(() => {
    load().then(() => {
      setLang(getSettings().lang || "en");
      setReady(true);
    });
  }, []);

  if (!ready) return <View style={s.root} />;

  const done = () => {
    setTick(tick + 1);
    setScreen("today");
  };
  const nav = (name) => setScreen(name);
  const pending = pendingCount();

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View style={s.shell}>
        <View style={s.header}>
          {screen !== "today" ? (
            <Pressable onPress={done} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
              <Text style={s.back}>‹</Text>
            </Pressable>
          ) : (
            <Text style={s.mark}>◆</Text>
          )}
          <Text style={s.title}>
            {screen === "today" ? `Kaicon Field — ${t("today")}` : t(TITLES[screen])}
          </Text>
          {screen === "today" ? (
            <Pressable onPress={() => setScreen("settings")} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("settings")}>
              <Text style={s.gear}>⚙</Text>
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        {screen === "today" && (
          <TodayScreen key={tick} t={t} lang={lang} workDate={workDate} pending={pending} nav={nav} />
        )}
        {screen === "item" && <AddItemScreen t={t} lang={lang} workDate={workDate} onDone={done} />}
        {screen === "labor" && <AddLaborScreen t={t} lang={lang} workDate={workDate} onDone={done} />}
        {screen === "photo" && <AddPhotoScreen t={t} lang={lang} workDate={workDate} onDone={done} />}
        {screen === "review" && <ReviewScreen t={t} workDate={workDate} onDone={done} />}
        {screen === "cos" && <ChangeOrdersScreen t={t} workDate={workDate} onDone={done} />}
        {screen === "settings" && (
          <SettingsScreen t={t} onDone={done} onLang={setLang} />
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Phone-first: cap content width when running on web/desktop (DD app pattern).
  shell: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    ...(Platform.OS === "web" ? { minHeight: "100vh" } : {}),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 40 : 14,
    paddingBottom: 10,
  },
  mark: { color: colors.brand, fontSize: 20 },
  back: { color: colors.text, fontSize: 30, fontWeight: "700", lineHeight: 30 },
  title: { color: colors.text, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },
  gear: { color: colors.textSecondary, fontSize: 20 },
});
