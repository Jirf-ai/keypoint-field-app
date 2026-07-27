// Kaicon Field — on-site daily capture (Franc's PRD v0.1 is the spec).
// Hand-rolled navigation (same pattern as the DD app): a screen stack in
// state, no navigation library. The first screen is capture, always.
import { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import FadeTransition from "./src/components/FadeTransition";
import LaunchSplash, { LogoRow } from "./src/components/LaunchSplash";
import ProjectsDrawer from "./src/components/ProjectsDrawer";
import { makeT } from "./src/i18n";
import { todayStr } from "./src/schema";
import { activeProfile, currentProject, getSettings, load, logOut, myProjects, myShareCode, pendingCount, recentProjects, saveSettings, setCurrentProject } from "./src/store";
import { syncNow } from "./src/sync";
import AuthScreen from "./src/screens/AuthScreen";
import AddItemScreen from "./src/screens/AddItemScreen";
import AddLaborScreen from "./src/screens/AddLaborScreen";
import AddPhotoScreen from "./src/screens/AddPhotoScreen";
import AddProjectScreen from "./src/screens/AddProjectScreen";
import JoinListScreen from "./src/screens/JoinListScreen";
import ChangeOrdersScreen from "./src/screens/ChangeOrdersScreen";
import ReviewScreen from "./src/screens/ReviewScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import TodayScreen from "./src/screens/TodayScreen";
import { colors, ensureFontsWeb, fonts, type } from "./src/theme";

// Hold the native splash until the animated overlay is on screen.
SplashScreen.preventAutoHideAsync().catch(() => {});
// Keypoint type system — inject Google Fonts on web (native uses expo-font).
ensureFontsWeb();

// Worker avatar with a dead-image fallback: old profiles may hold a blob: URI
// that didn't survive a reload — show their initial rather than a gray dot.
function ProfileAvatar({ profile }) {
  const [broken, setBroken] = useState(false);
  if (!profile?.selfie_uri || broken) {
    return (
      <View style={[s.avatar, s.avatarEmpty]}>
        <Text style={s.avatarInitial}>{profile?.display_name?.[0] ?? "?"}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: profile.selfie_uri }}
      style={s.avatar}
      onError={() => setBroken(true)}
    />
  );
}

// Compact language switch — always available, top right (Jeffrey 2026-07-24).
function LangToggle({ lang, onLang }) {
  return (
    <View style={s.langWrap}>
      {["en", "es", "zh"].map((c) => (
        <Pressable
          key={c}
          onPress={() => onLang(c)}
          style={[s.langBtn, lang === c && s.langOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: lang === c }}
          accessibilityLabel={c === "en" ? "English" : c === "es" ? "Español" : "中文"}
        >
          <Text style={[s.langText, lang === c && s.langTextOn]}>
            {c === "zh" ? "中文" : c.toUpperCase()}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const TITLES = {
  today: "today",
  item: "item",
  labor: "labor",
  photo: "photo",
  review: "review",
  cos: "changeOrders",
  settings: "settings",
  addproject: "addProjectTitle",
  joinlist: "joinListTitle",
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
  // Projects drawer (Option A) — opened from the header avatar.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const workDate = todayStr();
  const t = makeT(lang);

  // Midnight rollover: if the app sits open past 12:00am, notice the new day
  // within a minute and re-render — Today becomes the new (empty) day and
  // yesterday's log stays locked to its own date.
  useEffect(() => {
    const iv = setInterval(() => {
      if (todayStr() !== workDate) setTick((x) => x + 1);
    }, 60_000);
    return () => clearInterval(iv);
  }, [workDate]);

  // Worker identity: no profile, no capture — first run shows log-in/create.
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    load().then(() => {
      setLang(getSettings().lang || "en");
      setProfile(activeProfile());
      setReady(true);
    });
    SplashScreen.hideAsync().catch(() => {}); // overlay takes over from here
  }, []);

  // Background sync: every landing on Today (app open, back from a capture
  // screen) pushes whatever's pending. syncNow() is single-flight and a no-op
  // when the queue is empty; offline it fails silently and retries next time.
  useEffect(() => {
    if (!ready || !profile || screen !== "today") return;
    syncNow().then(() => setTick((x) => x + 1));
  }, [ready, profile, screen]);

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
  const authed = !!profile;
  // All the worker's projects for the drawer: current + owned/joined + recents,
  // deduped, current first.
  const drawerProjects = () => {
    const seen = new Set();
    const list = [];
    const push = (p) => { if (p && p.id && !seen.has(p.id)) { seen.add(p.id); list.push(p); } };
    push(currentProject());
    myProjects().forEach(push);
    recentProjects().forEach(push);
    return list;
  };
  const showLogoHeader = !authed || screen === "today";
  const changeLang = (c) => {
    setLang(c);
    saveSettings({ lang: c }); // persists; fire-and-forget
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View style={s.shell}>
        <View style={[s.header, !showLogoHeader && s.headerRule]}>
          {!showLogoHeader ? (
            <>
              <Pressable onPress={done} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={s.backHit}>
                <Text style={s.back}>‹</Text>
              </Pressable>
              <Text style={s.title}>{t(TITLES[screen])}</Text>
              <View style={{ width: 26 }} />
            </>
          ) : (
            <>
              {/* Logo sits in the normal flex flow (left), so it can never
                  collide with the language/gear cluster on narrow phones.
                  Worker avatar (their selfie) taps through to settings. */}
              <View style={s.headerLeft}>
                {authed && (
                  <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("projectsLabel")}>
                    <ProfileAvatar profile={profile} />
                  </Pressable>
                )}
                <View ref={logoSlotRef} collapsable={false} style={{ opacity: splashDone ? 1 : 0, flexShrink: 1 }}>
                  <LogoRow />
                </View>
              </View>
              <View style={s.headerRight}>
                <LangToggle lang={lang} onLang={changeLang} />
                {authed && (
                  <Pressable onPress={() => setScreen("settings")} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("settings")}>
                    <Text style={s.gear}>⚙</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>

        <FadeTransition screenKey={authed ? screen : "auth"}>
        {!authed && (
          <AuthScreen
            t={t}
            lang={lang}
            onDone={(p) => {
              setProfile(p);
              setLang(p.preferred_language ?? lang);
              setTick(tick + 1);
              setScreen("today");
            }}
          />
        )}

        {authed && screen === "today" && (
          <TodayScreen
            key={tick}
            t={t}
            lang={lang}
            workDate={workDate}
            pending={pending}
            onSync={() => syncNow().then(() => setTick((x) => x + 1))}
            nav={nav}
            onFillPhoto={(p) => {
              setFromPhoto(p);
              setScreen("item");
            }}
            onProjectChange={() => setTick(tick + 1)}
          />
        )}
        {authed && screen === "item" && (
          <AddItemScreen t={t} lang={lang} workDate={workDate} onDone={done} fromPhoto={fromPhoto} />
        )}
        {authed && screen === "labor" && <AddLaborScreen t={t} lang={lang} workDate={workDate} onDone={done} />}
        {authed && screen === "photo" && <AddPhotoScreen t={t} lang={lang} workDate={workDate} onDone={done} />}
        {authed && screen === "review" && <ReviewScreen t={t} workDate={workDate} onDone={done} />}
        {authed && screen === "cos" && <ChangeOrdersScreen t={t} workDate={workDate} onDone={done} />}
        {authed && screen === "addproject" && <AddProjectScreen t={t} onDone={done} />}
        {authed && screen === "joinlist" && <JoinListScreen t={t} onDone={done} />}
        {authed && screen === "settings" && (
          <SettingsScreen
            t={t}
            onDone={done}
            onLogout={async () => {
              await logOut();
              setProfile(null);
              setScreen("today");
            }}
          />
        )}
        </FadeTransition>

        {authed && (
          <ProjectsDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            t={t}
            profile={profile}
            role={profile?.role}
            current={currentProject()}
            projects={drawerProjects()}
            shareCode={myShareCode()}
            onPick={async (p) => {
              await setCurrentProject(p);
              setDrawerOpen(false);
              setScreen("today");
              setTick((x) => x + 1);
            }}
            onAdd={() => { setDrawerOpen(false); setScreen("addproject"); }}
            onJoin={() => { setDrawerOpen(false); setScreen("joinlist"); }}
          />
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
  headerRule: { borderBottomWidth: 1, borderBottomColor: colors.border },
  mark: { color: colors.accent, fontSize: 20 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceSunken },
  avatarEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  avatarInitial: { fontFamily: fonts.mono, color: colors.onInk, fontSize: 12, fontWeight: "700" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 9, flexShrink: 1, minWidth: 0 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 },
  langWrap: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    overflow: "hidden",
  },
  langBtn: { paddingVertical: 4, paddingHorizontal: 9 },
  langOn: { backgroundColor: colors.ink },
  langText: { fontFamily: fonts.mono, color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  langTextOn: { color: colors.onInk },
  backHit: { width: 26, alignItems: "flex-start" },
  back: { color: colors.text, fontSize: 30, fontWeight: "700", lineHeight: 30 },
  title: { ...type.navTitle },
  gear: { color: colors.textMuted, fontSize: 20 },
});
