// Kaicon Field — on-site daily capture (Franc's PRD v0.1 is the spec).
// Hand-rolled navigation (same pattern as the DD app): a screen stack in
// state, no navigation library. The first screen is capture, always.
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import LaunchSplash, { LogoRow } from "./src/components/LaunchSplash";
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

// Hold the native splash until the animated overlay is on screen.
SplashScreen.preventAutoHideAsync().catch(() => {});

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

  // Launch animation: overlay spins the diamond, then glides into the header
  // logo slot (measured by polling — onLayout is dead on RN-web/Expo 57).
  const logoSlotRef = useRef(null);
  const [dock, setDock] = useState(null);
  const [splashDone, setSplashDone] = useState(false);

  // Photo-first flow: an inbox photo tapped on Today opens the material form
  // with the photo attached (linked to the new line on save).
  const [fromPhoto, setFromPhoto] = useState(null);

  const workDate = todayStr();
  const t = makeT(lang);

  useEffect(() => {
    load().then(() => {
      setLang(getSettings().lang || "en");
      setReady(true);
    });
    SplashScreen.hideAsync().catch(() => {}); // overlay takes over from here
  }, []);

  useEffect(() => {
    if (dock || splashDone) return;
    const iv = setInterval(() => {
      logoSlotRef.current?.measureInWindow?.((x, y, w, h) => {
        if (w > 0 && h > 0) setDock((d) => d ?? { x, y, w, h });
      });
    }, 100);
    return () => clearInterval(iv);
  }, [dock, splashDone]);

  if (!ready) return <View style={s.root} />;

  const done = () => {
    setTick(tick + 1);
    setFromPhoto(null);
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
            <>
              <Pressable onPress={done} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
                <Text style={s.back}>‹</Text>
              </Pressable>
              <Text style={s.title}>{t(TITLES[screen])}</Text>
              <View style={{ width: 24 }} />
            </>
          ) : (
            <>
              <View style={{ width: 24 }} />
              {/* The splash docks into this slot; hidden until it lands. */}
              <View
                ref={logoSlotRef}
                collapsable={false}
                style={{ opacity: splashDone ? 1 : 0 }}
              >
                <LogoRow />
              </View>
              <Pressable onPress={() => setScreen("settings")} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("settings")}>
                <Text style={s.gear}>⚙</Text>
              </Pressable>
            </>
          )}
        </View>

        {screen === "today" && (
          <TodayScreen
            key={tick}
            t={t}
            lang={lang}
            workDate={workDate}
            pending={pending}
            nav={nav}
            onFillPhoto={(p) => {
              setFromPhoto(p);
              setScreen("item");
            }}
          />
        )}
        {screen === "item" && (
          <AddItemScreen t={t} lang={lang} workDate={workDate} onDone={done} fromPhoto={fromPhoto} />
        )}
        {screen === "labor" && <AddLaborScreen t={t} lang={lang} workDate={workDate} onDone={done} />}
        {screen === "photo" && <AddPhotoScreen t={t} lang={lang} workDate={workDate} onDone={done} />}
        {screen === "review" && <ReviewScreen t={t} workDate={workDate} onDone={done} />}
        {screen === "cos" && <ChangeOrdersScreen t={t} workDate={workDate} onDone={done} />}
        {screen === "settings" && (
          <SettingsScreen t={t} onDone={done} onLang={setLang} />
        )}
      </View>
      {!splashDone && <LaunchSplash dock={dock} onDone={() => setSplashDone(true)} />}
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
