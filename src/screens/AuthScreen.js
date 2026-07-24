// Log in / create account — the gate after the splash. First-timers create a
// profile (name + REQUIRED selfie + usual trade + language); returning workers
// tap their face and they're in. After this, opening the app lands straight on
// capture. Local profiles for the pilot; phone-OTP auth arrives with the sync
// backend (Tech Eval stack).
import { useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted, PickRow } from "../components/ui";
import { REQUIRE_PHONE_VERIFICATION, TRADES } from "../schema";
import { createProfile, logIn, profiles } from "../store";
import { colors, radius } from "../theme";

export default function AuthScreen({ t, lang, onDone }) {
  const existing = profiles();
  const [creating, setCreating] = useState(existing.length === 0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [trade, setTrade] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [err, setErr] = useState(null);
  // Phone confirmation step — rendered only when the public-release flag is
  // on. Verification will run through Supabase phone-OTP; until that backend
  // exists this UI is the contract, not the implementation.
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState(false);

  // Selfies persist as base64 data URIs — a blob: URL dies on page reload
  // (web) and a cache path can be evicted (native). A profile photo must
  // survive forever; it's small (square-cropped, half quality).
  function assetToUri(asset) {
    if (asset.base64) return `data:image/jpeg;base64,${asset.base64}`;
    return asset.uri;
  }

  // Belt and suspenders: whatever the picker returned, guarantee a data: URI
  // on web before it's stored (fetch the blob and re-encode). Never trust a
  // blob: URL to outlive the session.
  async function ensureDurable(uri) {
    if (!uri || uri.startsWith("data:") || Platform.OS !== "web") return uri;
    try {
      const blob = await (await fetch(uri)).blob();
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    } catch {
      return uri;
    }
  }

  async function takeSelfie() {
    setErr(null);
    const opts = { quality: 0.4, allowsEditing: true, aspect: [1, 1], base64: true };
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      const res = perm.granted
        ? await ImagePicker.launchCameraAsync({
            ...opts,
            cameraType: ImagePicker.CameraType?.front,
          })
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (!res.canceled && res.assets?.[0]) setSelfie(assetToUri(res.assets[0]));
    } catch {
      // Web fallback: camera unsupported → library picker.
      try {
        const res = await ImagePicker.launchImageLibraryAsync(opts);
        if (!res.canceled && res.assets?.[0]) setSelfie(assetToUri(res.assets[0]));
      } catch (e2) {
        setErr(String(e2?.message ?? e2));
      }
    }
  }

  async function finishCreate() {
    const p = await createProfile({
      display_name: name.trim(),
      default_trade: trade,
      lang,
      selfie_uri: await ensureDurable(selfie),
      phone: phone.trim() || null,
    });
    onDone(p);
  }

  async function create() {
    if (!name.trim() || !selfie) return;
    if (REQUIRE_PHONE_VERIFICATION) {
      if (!phone.trim()) return;
      // Public release: request OTP here (supabase.auth.signInWithOtp phone),
      // then collect the code below.
      setVerifying(true);
      return;
    }
    await finishCreate(); // pilot/internal: bypass on our terms
  }

  async function verifyCode() {
    // Public release: supabase.auth.verifyOtp({ phone, token: code }).
    if (code.trim().length !== 6) {
      setCodeErr(true);
      return;
    }
    await finishCreate();
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
            <FloatingLabelInput label={t("yourName")} value={name} onChangeText={setName} style={{ marginBottom: 10 }} />
            <FloatingLabelInput
              label={t("phone")}
              value={phone}
              onChangeText={(x) => setPhone(x.replace(/[^0-9+() -]/g, ""))}
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
            <Muted style={{ marginTop: 6 }}>{t("phoneHint")}</Muted>
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

          {verifying && (
            <Card>
              <Label>{t("enterCode")}</Label>
              <FloatingLabelInput
                label="______"
                value={code}
                onChangeText={(x) => {
                  setCode(x.replace(/[^0-9]/g, "").slice(0, 6));
                  setCodeErr(false);
                }}
                keyboardType="number-pad"
                autoCapitalize="none"
              />
              {codeErr && <Text style={s.err}>{t("codeWrong")}</Text>}
              <View style={{ gap: 10, marginTop: 12 }}>
                <BigButton label={t("verify")} onPress={verifyCode} disabled={code.length !== 6} />
                <BigButton label={t("cancel")} onPress={() => setVerifying(false)} tone="plain" />
              </View>
            </Card>
          )}

          {!verifying && (
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              <BigButton
                label={REQUIRE_PHONE_VERIFICATION ? t("sendCode") : t("start")}
                onPress={create}
                disabled={
                  !name.trim() || !selfie || (REQUIRE_PHONE_VERIFICATION && !phone.trim())
                }
              />
              {existing.length > 0 && (
                <BigButton label={t("logIn")} onPress={() => setCreating(false)} tone="plain" />
              )}
            </View>
          )}
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
  selfieRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  selfieBig: { width: 96, height: 96, borderRadius: 48, backgroundColor: "#eee" },
  err: { color: colors.red, marginTop: 8, fontSize: 13.5 },
});
