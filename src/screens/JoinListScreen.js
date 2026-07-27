// Join a project list (crew). Enter a site manager's share code to pull their
// projects into your picker. Resolves on-device now; the same code resolves
// server-side once sync lands.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, Field, FormScreen, StickyFooter } from "../components/ui";
import { joinByCode, setCurrentProject } from "../store";
import { colors, fonts } from "../theme";

export default function JoinListScreen({ t, onDone }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);

  async function join() {
    const r = await joinByCode(code);
    setResult(r);
    if (r.ok) {
      if (r.projects?.[0]) await setCurrentProject(r.projects[0]);
      setTimeout(onDone, 1300);
    }
  }

  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={t("joinCta")} onPrimary={join} disabled={code.trim().length < 4} />}>
      <Card>
        <Field
          label={t("joinCodeLabel")}
          value={code}
          onChangeText={(x) => setCode(x.toUpperCase())}
          autoCapitalize="characters"
          placeholder="KP-7F3A"
          hint={t("joinCodeHint")}
        />
      </Card>

      {result && !result.ok && (
        <Card style={s.errCard}>
          <Text style={s.errText}>{t("joinFailed")}</Text>
        </Card>
      )}
      {result && result.ok && (
        <Card style={s.okCard}>
          <Text style={s.okTitle}>{t("joinedOk")} · {result.owner}</Text>
          <Text style={s.okBody}>{result.projects.length} {result.projects.length === 1 ? "project" : "projects"} added to your list.</Text>
        </Card>
      )}
    </FormScreen>
  );
}

const s = StyleSheet.create({
  errCard: { borderColor: "#b91c1c33", backgroundColor: "#b91c1c0a" },
  errText: { fontFamily: fonts.body, color: colors.red, fontSize: 14, lineHeight: 20 },
  okCard: { borderColor: "#15803d33", backgroundColor: "#15803d0a" },
  okTitle: { fontFamily: fonts.body, color: colors.green, fontSize: 14.5, fontWeight: "700" },
  okBody: { fontFamily: fonts.body, color: colors.textSecondary, fontSize: 13, marginTop: 3 },
});
