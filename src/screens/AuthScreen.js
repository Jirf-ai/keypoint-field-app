// Log in / create account — the gate after the splash. First-timers create a
// profile (name + REQUIRED selfie + usual trade + language); returning workers
// tap their face and they're in. After this, opening the app lands straight on
// capture. Local profiles for the pilot; phone-OTP auth arrives with the sync
// backend (Tech Eval stack).
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted, PickRow } from "../components/ui";
import { TRADES } from "../schema";
import { createProfile, logIn, profiles } from "../store";
import { colors, radius } from "../theme";

const LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

export default function AuthScreen({ t, lang, onLang, onDone }) {
  const existing = profiles();
  const [creating, setCreating] = useState(existing.length === 0);
  const [name, setName] = useState("");
  const [trade, setTrade] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [err, setErr] = useState(null);

  async function takeSelfie() {
    setErr(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      const res = perm.granted
        ? await ImagePicker.launchCameraAsync({
            quality: 0.5,
            cameraType: ImagePicker.CameraType?.front,
            allowsEditing: true,
            aspect: [1, 1],
          })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, allowsEditing: true, aspect: [1, 1] });
      if (!res.canceled && res.assets?.[0]?.uri) setSelfie(res.assets[0].uri);
    } catch {
      // Web fallback: camera unsupported → library picker.
      try {
        const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
        if (!res.canceled && res.assets?.[0]?.uri) setSelfie(res.assets[0].uri);
      } catch (e2) {
        setErr(String(e2?.message ?? e2));
      }
    }
  }

  async function create() {
    if (!name.trim() || !selfie) return;
    const p = await createProfile({
      display_name: name.trim(),
      default_trade: trade,
      lang,
      selfie_uri: selfie,
    });
    onDone(p);
  }

  async function pick(worker_id) {
    const p = await logIn(worker_id);
    if (p) onDone(p);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      {!creating && (
        <>
          <Card>
            <Label>{t("logIn")}</Label>
            <Muted style={{ marginBottom: 12 }}>{t("pickProfile")}</Muted>
            <View style={s.grid}>
              {existing.map((p) => (
                <Pressable
                  key={p.worker_id}
                  style={s.profile}
                  onPress={() => pick(p.worker_id)}
                  accessibilityRole="button"
                  accessibilityLabel={p.display_name}
                >
                  {p.selfie_uri ? (
                    <Image source={{ uri: p.selfie_uri }} style={s.avatar} />
                  ) : (
                    <View style={[s.avatar, s.avatarEmpty]}>
                      <Text style={s.avatarInitial}>{p.display_name?.[0] ?? "?"}</Text>
                    </View>
                  )}
                  <Text style={s.profileName} numberOfLines={1}>{p.display_name}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Muted style={{ textAlign: "center" }}>{t("newHere")}</Muted>
            <BigButton label={t("createAccount")} onPress={() => setCreating(true)} tone="plain" />
          </View>
        </>
      )}

      {creating && (
        <>
          <Card>
            <Label>{t("createAccount")}</Label>
            <Muted style={{ marginBottom: 12 }}>{t("whoAreYouHint")}</Muted>
            <View style={s.langRow}>
              {LANGS.map((l) => (
                <BigButton
                  key={l.code}
                  label={l.label}
                  onPress={() => onLang(l.code)}
                  tone={lang === l.code ? "brand" : "plain"}
                  style={{ flex: 1 }}
                />
              ))}
            </View>
            <FloatingLabelInput label={t("yourName")} value={name} onChangeText={setName} style={{ marginTop: 12 }} />
            <Label>{t("yourTrade")}</Label>
            <PickRow options={TRADES} value={trade} onChange={setTrade} renderLabel={(o) => o[lang] ?? o.en} />
          </Card>

          <Card>
            <Label>{t("profileSelfie")}</Label>
            {selfie ? (
              <View style={s.selfieRow}>
                <Image source={{ uri: selfie }} style={s.selfieBig} />
                <BigButton label={t("retakeSelfie")} onPress={takeSelfie} tone="plain" style={{ flex: 1 }} />
              </View>
            ) : (
              <BigButton label={`🤳  ${t("takeSelfie")}`} onPress={takeSelfie} />
            )}
            <Muted style={{ marginTop: 10 }}>{t("selfieWhy")}</Muted>
            {err && <Text style={s.err}>{err}</Text>}
          </Card>

          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            <BigButton label={t("start")} onPress={create} disabled={!name.trim() || !selfie} />
            {existing.length > 0 && (
              <BigButton label={t("logIn")} onPress={() => setCreating(false)} tone="plain" />
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  profile: { alignItems: "center", width: 86 },
  avatar: { width: 74, height: 74, borderRadius: 37, backgroundColor: "#eee" },
  avatarEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTint },
  avatarInitial: { color: colors.brand, fontSize: 28, fontWeight: "800" },
  profileName: { color: colors.text, fontSize: 13.5, fontWeight: "700", marginTop: 6 },
  langRow: { flexDirection: "row", gap: 10 },
  selfieRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  selfieBig: { width: 96, height: 96, borderRadius: 48, backgroundColor: "#eee" },
  err: { color: colors.red, marginTop: 8, fontSize: 13.5 },
});
