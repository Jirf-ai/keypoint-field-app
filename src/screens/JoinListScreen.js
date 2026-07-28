// Join a project list (crew). Enter a site manager's share code to pull their
// projects into your picker. Resolves on-device now; the same code resolves
// server-side once sync lands.
import { useState } from "react";
import { Card, Field, FormScreen, Muted, NoticeCard, StickyFooter } from "../components/ui";
import { joinByCode, setCurrentProject } from "../store";

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

      {result && !result.ok && <NoticeCard tone="error" title={t("joinFailed")} />}
      {result && result.ok && (
        <NoticeCard tone="success" title={`${t("joinedOk")} · ${result.owner}`}>
          <Muted>{result.projects.length} {t("projectsAdded")}</Muted>
        </NoticeCard>
      )}
    </FormScreen>
  );
}
