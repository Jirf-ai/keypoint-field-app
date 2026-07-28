// Log in / create account — the gate after the splash. First-timers create a
// profile (name + selfie + role + usual trade); returning workers tap their
// face. Keypoint system: title on the cream ground, labelled fields, role as a
// 2-up grid, trade as a collapsing chip wall, selfie as a framed prompt.
//
// Two codes, two jobs (2026-07-27):
//   - GC TEAM CODE (server, gc_accounts): the company's standing code. NO
//     worker of any role can register without one — the GC's registration +
//     data-sharing consent is what makes the crew's capture legitimate.
//   - Site-manager SHARE CODE (local, team projects): crew additionally join
//     their manager's project list at signup (can't record against a project
//     no manager owns).
import { useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Btn, Card, ChipWall, Field, GroupLabel, Muted, preferred } from "../components/ui";
import { call } from "../api";
import { REQUIRE_PHONE_VERIFICATION, TRADES } from "../schema";
import { copyToClipboard } from "../util";
import { newWorkerId, sendOtp, verifyOtp } from "../auth";
import { createProfile, gcAccount, joinByCode, logIn, profiles, resolveShareCode, restoreProfile, setGcAccount } from "../store";
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
  // Crew must join a site manager's project list at signup (business rule):
  // they can't record against a project that no manager owns.
  const [mgrCode, setMgrCode] = useState("");
  const [mgrCodeErr, setMgrCodeErr] = useState(false);
  const isCrew = role === "journeyman";
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState(false);
  const [pendingGc, setPendingGc] = useState(null);
  const [pendingWorkerId, setPendingWorkerId] = useState(null);
  const [devCode, setDevCode] = useState(null); // dev/pilot: shown so testing works

  // "Log in with phone" — cross-device account restore (its own mini-flow).
  const [phoneLogin, setPhoneLogin] = useState(false);
  const [lgPhone, setLgPhone] = useState("");
  const [lgCode, setLgCode] = useState("");
  const [lgSent, setLgSent] = useState(false);
  const [lgDev, setLgDev] = useState(false);
  const [lgErr, setLgErr] = useState(null);
  const [lgBusy, setLgBusy] = useState(false);

  // GC team code gate: required for every new profile; a GC session on this
  // device pre-fills its own code.
  const gc = gcAccount();
  const [teamCode, setTeamCode] = useState(gc?.gc_code ?? "");
  const [codeState, setCodeState] = useState(null); // null | 'invalid' | 'offline'

  // GC panel: null | 'register' | 'login' | 'code' (code = show team code)
  const [gcMode, setGcMode] = useState(null);
  const [gcBiz, setGcBiz] = useState("");
  const [gcContact, setGcContact] = useState("");
  const [gcPhone, setGcPhone] = useState("");
  const [gcEmail, setGcEmail] = useState("");
  const [gcConsent, setGcConsent] = useState(false);
  const [gcErr, setGcErr] = useState(null);
  const [copied, setCopied] = useState(false);

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

  async function finishCreate(gcInfo, workerId, phoneVerified) {
    const p = await createProfile({
      worker_id: workerId,
      display_name: name.trim(),
      default_trade: trade,
      lang,
      selfie_uri: await ensureDurable(selfie),
      phone: phone.replace(/\D/g, "") || null,
      phone_verified: !!phoneVerified,
      role,
      gc: gcInfo,
    });
    // Crew join their manager's project list right after the profile exists.
    if (isCrew && mgrCode.trim()) await joinByCode(mgrCode);
    // When phone-verified, worker-auth already recorded the worker (with
    // phone_verified) on this phone. Only the non-OTP path still needs
    // gc-account to register it. Fire-and-forget: the code was validated online.
    if (!phoneVerified && gcInfo?.gc_code) {
      call("gc-account", {
        action: "verify",
        gc_code: gcInfo.gc_code,
        worker: {
          worker_id: p.worker_id,
          display_name: p.display_name,
          phone: p.phone,
          role: p.role,
          trade: p.default_trade,
        },
      }).catch(() => {});
    }
    onDone(p);
  }

  // No code, no account: the GC's registration (and consent) is what makes
  // the crew's capture legitimate — validated server-side, online required.
  async function validateTeamCode() {
    const codeInput = teamCode.trim().toUpperCase();
    if (gc && codeInput === gc.gc_code) {
      return { gc_account_id: gc.gc_account_id, gc_code: gc.gc_code, business_name: gc.business_name };
    }
    let r;
    try {
      r = await call("gc-account", { action: "verify", gc_code: codeInput });
    } catch {
      setCodeState("offline");
      return null;
    }
    if (!r || (!r.valid && r.status >= 500)) { setCodeState("offline"); return null; }
    if (!r.valid) { setCodeState("invalid"); return null; }
    return { gc_account_id: r.gc_account_id, gc_code: codeInput, business_name: r.business_name };
  }

  async function create() {
    // Full signup, no shortcuts: name, role, team code AND the selfie — the
    // GC code authorizes the profile, it never replaces registration.
    if (!name.trim() || !role || !teamCode.trim() || !selfie) return;
    // Crew need a valid site-manager code before an account is created.
    if (isCrew) {
      if (!resolveShareCode(mgrCode)) {
        setMgrCodeErr(true);
        return;
      }
    }
    setBusy(true);
    setCodeState(null);
    const gcInfo = await validateTeamCode();
    if (!gcInfo) { setBusy(false); return; }
    if (REQUIRE_PHONE_VERIFICATION) {
      if (!phone.trim()) { setBusy(false); return; }
      const send = await sendOtp(phone.replace(/\D/g, ""));
      setBusy(false);
      if (!send?.ok) { setErr(send?.error ?? t("needOnline")); return; }
      setPendingGc(gcInfo);
      setPendingWorkerId(newWorkerId());
      setDevCode(send.dev_code ?? null);
      if (send.dev_code) setCode(send.dev_code); // prefill for dev/pilot testing
      setVerifying(true);
      return;
    }
    setBusy(false);
    await finishCreate(gcInfo, newWorkerId(), false);
  }

  async function verifyCode() {
    const c = code.trim();
    if (c.length !== 6) {
      setCodeErr(true);
      return;
    }
    setBusy(true);
    setCodeErr(false);
    const worker = {
      worker_id: pendingWorkerId,
      display_name: name.trim(),
      role,
      trade,
      gc_account_id: pendingGc?.gc_account_id ?? null,
    };
    const r = await verifyOtp(phone.replace(/\D/g, ""), c, worker);
    setBusy(false);
    if (!r?.ok || !r.verified) {
      setCodeErr(true);
      return;
    }
    await finishCreate(pendingGc, pendingWorkerId, true);
  }

  // ---- Log in with phone (cross-device restore) ----
  async function lgSend() {
    const ph = lgPhone.replace(/\D/g, "");
    if (ph.length < 10) { setLgErr(t("codeWrong")); return; }
    setLgBusy(true);
    setLgErr(null);
    const send = await sendOtp(ph);
    setLgBusy(false);
    if (!send?.ok) { setLgErr(send?.error ?? t("needOnline")); return; }
    setLgSent(true);
    setLgDev(!!send.dev_code);
    if (send.dev_code) setLgCode(send.dev_code); // dev/pilot prefill
  }

  async function lgVerify() {
    const ph = lgPhone.replace(/\D/g, "");
    if (lgCode.trim().length !== 6) { setLgErr(t("codeWrong")); return; }
    setLgBusy(true);
    setLgErr(null);
    const r = await verifyOtp(ph, lgCode.trim());
    setLgBusy(false);
    if (!r?.ok || !r.verified) { setLgErr(t("codeWrong")); return; }
    if (!r.accounts || r.accounts.length === 0) { setLgErr(t("noAccountForPhone")); return; }
    const p = await restoreProfile(r.accounts[0], ph);
    onDone(p);
  }

  async function pick(worker_id) {
    const p = await logIn(worker_id);
    if (p) onDone(p);
  }

  // ---------------------------------------------------------------- GC panel
  async function gcRegister() {
    if (!gcBiz.trim() || !gcPhone.trim() || !gcEmail.trim() || !gcConsent) return;
    setBusy(true);
    setGcErr(null);
    let r;
    try {
      r = await call("gc-account", {
        action: "register",
        business_name: gcBiz.trim(),
        contact_name: gcContact.trim() || null,
        phone: gcPhone.trim(),
        email: gcEmail.trim(),
        consent: true,
      });
    } catch { r = null; }
    setBusy(false);
    if (!r?.ok) { setGcErr(r?.error ? t("gcNotFound") : t("needOnline")); return; }
    await setGcAccount({
      gc_account_id: r.gc_account_id, gc_code: r.gc_code,
      business_name: r.business_name, phone: gcPhone.trim(), email: gcEmail.trim(),
    });
    setTeamCode(r.gc_code);
    setGcMode("code");
  }

  async function gcLogin() {
    setBusy(true);
    setGcErr(null);
    let r;
    try {
      r = await call("gc-account", { action: "login", gc_code: teamCode.trim().toUpperCase(), phone: gcPhone.trim() });
    } catch { r = null; }
    setBusy(false);
    if (!r?.ok) { setGcErr(r?.status === 404 ? t("gcNotFound") : t("needOnline")); return; }
    await setGcAccount({
      gc_account_id: r.gc_account_id, gc_code: r.gc_code,
      business_name: r.business_name, phone: r.phone, email: r.email,
    });
    setTeamCode(r.gc_code);
    setGcMode("code");
  }

  async function copyCode(codeStr) {
    if (await copyToClipboard(codeStr)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  // ---- Log in with phone (cross-device account restore) ----
  if (phoneLogin) {
    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
        <View style={s.head}>
          <Text style={type.screenTitle}>{t("phoneLoginTitle")}</Text>
          <Text style={s.headSub}>{t("phoneLoginHint")}</Text>
        </View>
        <Card>
          <Field
            label={t("phone")}
            value={lgPhone}
            onChangeText={(x) => setLgPhone(formatPhone(x))}
            keyboardType="phone-pad"
            autoCapitalize="none"
            placeholder="(626) - 555 - 0100"
          />
          {lgSent && (
            <>
              {lgDev ? <Muted style={{ marginTop: 12 }}>{t("devCodeNote")} {lgCode}</Muted> : null}
              <Field
                label={t("enterCode")}
                value={lgCode}
                onChangeText={(x) => setLgCode(x.replace(/[^0-9]/g, "").slice(0, 6))}
                keyboardType="number-pad"
                autoCapitalize="none"
                placeholder="______"
                style={{ marginTop: 8 }}
              />
            </>
          )}
          {lgErr && <Text style={s.err}>{lgErr}</Text>}
        </Card>
        <View style={{ paddingHorizontal: 14, gap: 10 }}>
          {!lgSent ? (
            <Btn label={t("sendCode")} onPress={lgSend} disabled={lgBusy || lgPhone.replace(/\D/g, "").length < 10} />
          ) : (
            <Btn label={t("logIn")} onPress={lgVerify} disabled={lgBusy || lgCode.length !== 6} />
          )}
          <Btn label={t("cancel")} onPress={() => { setPhoneLogin(false); setLgSent(false); setLgCode(""); setLgErr(null); }} variant="outline" />
        </View>
      </ScrollView>
    );
  }

  // ---- GC: register the company ----
  if (gcMode === "register") {
    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
        <View style={s.head}>
          <Text style={type.screenTitle}>{t("gcTitle")}</Text>
          <Text style={s.headSub}>{t("gcIntro")}</Text>
        </View>
        <Card>
          <Field label={t("businessName")} value={gcBiz} onChangeText={setGcBiz} style={{ marginBottom: 12 }} />
          <Field label={t("contactName")} value={gcContact} onChangeText={setGcContact} style={{ marginBottom: 12 }} />
          <Field label={t("gcPhone")} value={gcPhone} onChangeText={(x) => setGcPhone(formatPhone(x))} keyboardType="phone-pad" autoCapitalize="none" placeholder="(626) - 555 - 0100" style={{ marginBottom: 12 }} />
          <Field label={t("gcEmail")} value={gcEmail} onChangeText={setGcEmail} autoCapitalize="none" keyboardType="email-address" />
        </Card>
        <Card>
          <GroupLabel>{t("gcConsentTitle")}</GroupLabel>
          <Muted style={{ marginBottom: 12 }}>{t("gcConsentText")}</Muted>
          <Pressable style={s.consentRow} onPress={() => setGcConsent(!gcConsent)} accessibilityRole="checkbox" accessibilityState={{ checked: gcConsent }}>
            <View style={[s.checkbox, gcConsent && s.checkboxOn]}>
              {gcConsent && <Text style={s.checkmark}>✓</Text>}
            </View>
            <Text style={s.consentLabel}>{t("gcConsentCheck")}</Text>
          </Pressable>
          {gcErr && <Text style={s.err}>{gcErr}</Text>}
        </Card>
        <View style={{ paddingHorizontal: 14, gap: 10 }}>
          <Btn label={t("gcRegister")} onPress={gcRegister} disabled={busy || !gcBiz.trim() || !gcPhone.trim() || !gcEmail.trim() || !gcConsent} />
          <Btn label={t("gcLoginTab")} onPress={() => { setGcErr(null); setGcMode("login"); }} variant="outline" />
          <Btn label={t("cancel")} onPress={() => { setGcErr(null); setGcMode(null); }} variant="outline" />
        </View>
      </ScrollView>
    );
  }

  // ---- GC: log back in (code + business phone) ----
  if (gcMode === "login") {
    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
        <View style={s.head}>
          <Text style={type.screenTitle}>{t("gcLoginTab")}</Text>
          <Text style={s.headSub}>{t("gcLoginHint")}</Text>
        </View>
        <Card>
          <Field label={t("teamCode")} value={teamCode} onChangeText={(x) => setTeamCode(x.toUpperCase())} autoCapitalize="characters" placeholder="LOR-7XK4" style={{ marginBottom: 12 }} />
          <Field label={t("gcPhone")} value={gcPhone} onChangeText={(x) => setGcPhone(formatPhone(x))} keyboardType="phone-pad" autoCapitalize="none" />
          {gcErr && <Text style={s.err}>{gcErr}</Text>}
        </Card>
        <View style={{ paddingHorizontal: 14, gap: 10 }}>
          <Btn label={t("logIn")} onPress={gcLogin} disabled={busy || !teamCode.trim() || !gcPhone.trim()} />
          <Btn label={t("cancel")} onPress={() => { setGcErr(null); setGcMode(null); }} variant="outline" />
        </View>
      </ScrollView>
    );
  }

  // ---- GC: the standing team code ----
  if (gcMode === "code" && gc) {
    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
        <View style={s.head}>
          <Text style={type.screenTitle}>{t("gcCodeTitle")}</Text>
          <Text style={s.headSub}>{gc.business_name}</Text>
        </View>
        <Card>
          <Text selectable style={s.codeBig}>{gc.gc_code}</Text>
          <Muted style={{ marginTop: 8 }}>{t("gcCodeHint")}</Muted>
        </Card>
        <View style={{ paddingHorizontal: 14, gap: 10 }}>
          <Btn label={copied ? t("copiedCode") : `⧉  ${t("copyCode")}`} onPress={() => copyCode(gc.gc_code)} />
          <Btn label={t("gcContinueProfile")} onPress={() => { setTeamCode(gc.gc_code); setGcMode(null); setCreating(true); }} variant="outline" />
        </View>
      </ScrollView>
    );
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
        <View style={{ paddingHorizontal: 14, gap: 10 }}>
          <Btn label={t("createAccount")} onPress={() => setCreating(true)} variant="outline" />
          <Btn label={`📱  ${t("loginWithPhone")}`} onPress={() => setPhoneLogin(true)} variant="outline" />
          <Btn label={`🏗  ${t("gcEntry")}`} onPress={() => setGcMode(gc ? "code" : "register")} variant="outline" />
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
        <Field label={t("nameLabel")} value={name} onChangeText={setName} placeholder={t("nameHint")} style={{ marginBottom: 12 }} />
        <Field label={t("phone")} value={phone} onChangeText={(x) => setPhone(formatPhone(x))} keyboardType="phone-pad" autoCapitalize="none" placeholder="(626) - 555 - 0100" hint={t("phoneHint")} style={{ marginBottom: 12 }} />
        {/* No GC code, no account (Jeffrey 2026-07-27): every worker registers
            under their company's standing team code — the GC's consent is
            what makes the crew's capture legitimate. Validated online. */}
        <Field
          label={t("teamCode")}
          value={teamCode}
          onChangeText={(x) => { setTeamCode(x.toUpperCase()); setCodeState(null); }}
          autoCapitalize="characters"
          placeholder="LOR-7XK4"
          hint={gc && teamCode.trim().toUpperCase() === gc.gc_code ? `✓ ${gc.business_name}` : t("teamCodeHint")}
        />
        {codeState === "invalid" && <Text style={s.err}>{t("teamCodeInvalid")}</Text>}
        {codeState === "offline" && <Text style={s.err}>{t("needOnline")}</Text>}
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
        {/* Crew must be attached to a site manager's project list. */}
        {isCrew && (
          <View style={{ marginTop: 16 }}>
            <Field
              label={t("joinCodeLabel")}
              value={mgrCode}
              onChangeText={(x) => { setMgrCode(x.toUpperCase()); setMgrCodeErr(false); }}
              autoCapitalize="characters"
              placeholder="KP-7F3A"
              hint={t("joinCodeHint")}
            />
            {mgrCodeErr && <Text style={s.err}>{t("joinFailed")}</Text>}
          </View>
        )}
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
          {devCode ? <Muted style={{ marginBottom: 8 }}>{t("devCodeNote")} {devCode}</Muted> : null}
          <Field value={code} onChangeText={(x) => { setCode(x.replace(/[^0-9]/g, "").slice(0, 6)); setCodeErr(false); }} keyboardType="number-pad" autoCapitalize="none" placeholder="______" />
          {codeErr && <Text style={s.err}>{t("codeWrong")}</Text>}
          <View style={{ gap: 10, marginTop: 12 }}>
            <Btn label={t("verify")} onPress={verifyCode} disabled={busy || code.length !== 6} />
            <Btn label={t("cancel")} onPress={() => setVerifying(false)} variant="outline" />
          </View>
        </Card>
      )}

      {!verifying && (
        <View style={{ paddingHorizontal: 14, gap: 10 }}>
          <Btn
            label={REQUIRE_PHONE_VERIFICATION ? t("sendCode") : t("start")}
            onPress={create}
            disabled={busy || !role || !name.trim() || !teamCode.trim() || !selfie || (isCrew && mgrCode.trim().length < 4)}
          />
          <Btn label={`🏗  ${t("gcEntry")}`} onPress={() => setGcMode(gc ? "code" : "register")} variant="outline" />
          {/* Login lives on the log-in hub, not here — one quiet way back. */}
          <Pressable onPress={() => setCreating(false)} hitSlop={8} accessibilityRole="button" style={s.backLinkWrap}>
            <Text style={s.backLink}>{t("haveAccount")}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 14, marginTop: 4, marginBottom: 8 },
  headSub: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, marginTop: 4 },
  backLinkWrap: { alignItems: "center", paddingVertical: 8, marginTop: 2 },
  backLink: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "700", color: colors.accent },

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

  consentRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: colors.onInk, fontSize: 16, fontWeight: "800" },
  consentLabel: { fontFamily: fonts.body, color: colors.text, fontSize: 14.5, fontWeight: "700", flex: 1 },

  codeBig: {
    fontFamily: fonts.mono, color: colors.accent, fontSize: 32, fontWeight: "700",
    letterSpacing: 2, textAlign: "center", paddingVertical: 12,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 10,
    backgroundColor: colors.surfaceSunken, overflow: "hidden",
  },
});
