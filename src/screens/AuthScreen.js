// Log in / create account — the gate after the splash. First-timers create a
// profile (name + selfie + role + usual trade); returning workers tap their
// face. Keypoint system: title on the cream ground, labelled fields, role as a
// 2-up grid, trade as a collapsing chip wall, selfie as a framed prompt.
import { useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Btn, Card, ChipWall, Field, GroupLabel, Muted, preferred } from "../components/ui";
import { REQUIRE_PHONE_VERIFICATION, TRADES } from "../schema";
import { createProfile, logIn, profiles } from "../store";
import { colors, fonts, type } from "../theme";

const TRADE_ORDER = preferred(TRADES, ["laborer", "carpenter", "concrete", "framer", "electrician"]);

// Auto-format to (626) - 555 - 0100 — strip non-digits, cap 10.
function formatPhone(v) {
  const d = String(v).replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) - ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) - ${d.slice(3, 6)} - ${d.slice(6)}`;
}

export default function AuthScreen({ t, lang, onDone }) {
  const existing = profiles();
  const [creating, setCreating] = useState(existing.length === 0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(null);
  const [trade, setTrade] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [err, setErr] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState(false);

  function assetToUri(asset) {
    if (asset.base64) return `data:image/jpeg;base64,${asset.base64}`;
    return asset.uri;
  }

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
        ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType?.front })
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (!res.canceled && res.assets?.[0]) setSelfie(assetToUri(res.assets[0]));
    } catch {
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
      phone: phone.replace(/\D/g, "") || null,
      role,
    });
    onDone(p);
  }

  async function create() {
    if (!name.trim() || !role) return;
    if (REQUIRE_PHONE_VERIFICATION) {
      if (!phone.trim()) return;
      setVerifying(true);
      return;
    }
    await finishCreate();
  }

  async function verifyCode() {
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

  // ---- returning worker: pick a face ----
  if (!creating) {
    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
        <View style={s.head}>
          <Text style={type.screenTitle}>{t("logIn")}</Text>
          <Text style={s.headSub}>{t("pickProfile")}</Text>
        </View>
        <Card>
          <View style={s.faces}>
            {existing.map((p) => (
              <Pressable key={p.worker_id} style={s.face} onPress={() => pick(p.worker_id)} accessibilityRole="button" accessibilityLabel={p.display_name}>
                {p.selfie_uri ? (
                  <Image source={{ uri: p.selfie_uri }} style={s.faceImg} />
                ) : (
                  <View style={[s.faceImg, s.faceEmpty]}>
                    <Text style={s.faceInitial}>{p.display_name?.[0] ?? "?"}</Text>
                  </View>
                )}
                <Text style={s.faceName} numberOfLines={1}>{p.display_name}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
        <View style={{ paddingHorizontal: 14 }}>
          <Btn label={t("createAccount")} onPress={() => setCreating(true)} variant="outline" />
        </View>
      </ScrollView>
    );
  }

  // ---- create account ----
  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <View style={s.head}>
        <Text style={type.screenTitle}>{t("createTitle")}</Text>
        <Text style={s.headSub}>{t("createSub")}</Text>
      </View>

      <Card>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Goes on every entry" style={{ marginBottom: 12 }} />
        <Field label="Phone number" value={phone} onChangeText={(x) => setPhone(formatPhone(x))} keyboardType="phone-pad" autoCapitalize="none" placeholder="(626) - 555 - 0100" hint={t("phoneHint")} />
      </Card>

      <Card>
        <GroupLabel>{t("roleQuestion")}</GroupLabel>
        <View style={s.roleGrid}>
          {[["journeyman", t("roleCrewShort")], ["site_manager", t("roleSMShort")]].map(([codeVal, label]) => {
            const on = role === codeVal;
            return (
              <Pressable key={codeVal} onPress={() => setRole(codeVal)} style={[s.roleBtn, on && s.roleBtnOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[s.roleText, on && s.roleTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <GroupLabel right={t("optional")} style={{ marginTop: 16 }}>{t("usualTrade")}</GroupLabel>
        <ChipWall options={TRADE_ORDER} value={trade} onChange={setTrade} renderLabel={(o) => o[lang] ?? o.en} show={5} />
      </Card>

      <Pressable onPress={takeSelfie} accessibilityRole="button" accessibilityLabel={t("selfieShort")}>
        <Card style={s.selfieCard}>
          {selfie ? (
            <Image source={{ uri: selfie }} style={s.selfieImg} />
          ) : (
            <View style={s.selfieCircle}><Text style={s.selfieGlyph}>🤳</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.selfieTitle}>
              {t("selfieShort")} <Text style={{ color: colors.accent }}>{t("required")}</Text>
            </Text>
            <Text style={s.selfieSub}>{t("selfieSub")}</Text>
            {err ? <Text style={s.err}>{err}</Text> : null}
          </View>
        </Card>
      </Pressable>

      {verifying && (
        <Card>
          <GroupLabel>{t("enterCode")}</GroupLabel>
          <Field label="Code" value={code} onChangeText={(x) => { setCode(x.replace(/[^0-9]/g, "").slice(0, 6)); setCodeErr(false); }} keyboardType="number-pad" autoCapitalize="none" placeholder="______" />
          {codeErr && <Text style={s.err}>{t("codeWrong")}</Text>}
          <View style={{ gap: 10, marginTop: 12 }}>
            <Btn label={t("verify")} onPress={verifyCode} disabled={code.length !== 6} />
            <Btn label={t("cancel")} onPress={() => setVerifying(false)} variant="outline" />
          </View>
        </Card>
      )}

      {!verifying && (
        <View style={{ paddingHorizontal: 14, gap: 10 }}>
          <Btn label={REQUIRE_PHONE_VERIFICATION ? t("sendCode") : t("start")} onPress={create} disabled={!role || !name.trim()} />
          {existing.length > 0 && <Btn label={t("logIn")} onPress={() => setCreating(false)} variant="outline" />}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 14, marginTop: 4, marginBottom: 8 },
  headSub: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginTop: 4 },

  roleGrid: { flexDirection: "row", gap: 8 },
  roleBtn: { flex: 1, minHeight: 50, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  roleBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  roleText: { fontFamily: fonts.body, fontSize: 15, fontWeight: "500", color: colors.text },
  roleTextOn: { color: colors.onInk, fontWeight: "700" },

  selfieCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  selfieCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderDashed, alignItems: "center", justifyContent: "center" },
  selfieImg: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceSunken },
  selfieGlyph: { fontSize: 22 },
  selfieTitle: { fontFamily: fonts.body, fontSize: 15, fontWeight: "700", color: colors.text },
  selfieSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, marginTop: 3, lineHeight: 17 },
  err: { fontFamily: fonts.body, color: colors.red, marginTop: 8, fontSize: 13 },

  faces: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  face: { alignItems: "center", width: 86 },
  faceImg: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceSunken },
  faceEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  faceInitial: { fontFamily: fonts.mono, color: colors.onInk, fontSize: 26, fontWeight: "700" },
  faceName: { fontFamily: fonts.body, color: colors.text, fontSize: 13.5, fontWeight: "700", marginTop: 6 },
});
