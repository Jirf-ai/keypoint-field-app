// Today — the first screen after opening is CAPTURE, not a dashboard
// (PRD §6.1 design constraint). Three big buttons, today's entries below,
// pending-sync badge always visible (silence breeds distrust — Tech Eval §6.3).
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import ProjectPicker from "../components/ProjectPicker";
import { BigButton, Card, Muted } from "../components/ui";
import { phaseLabel } from "../i18n";
import {
  activeLines,
  currentProject,
  dayStatus,
  photosFor,
  recentProjects,
  setCurrentProject,
  todayTotals,
} from "../store";
import { CLASS_COLORS, colors } from "../theme";

function usd(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function LineRow({ l, lang, photoCount }) {
  const cc = CLASS_COLORS[l.cost_class] ?? CLASS_COLORS.M;
  const isLabor = l.kind === "labor";
  const title = isLabor ? `${l.worker} — ${l.hours}h` : l.description;
  const amount = isLabor
    ? Number(l.hours || 0) * Number(l.hourly_rate || 0)
    : Number(l.qty || 0) * Number(l.unit_cost || 0);
  return (
    <View style={s.lineRow}>
      <View style={[s.classDot, { backgroundColor: cc.bg }]}>
        <Text style={[s.classDotText, { color: cc.color }]}>{l.cost_class}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.lineTitle} numberOfLines={1}>
          {title}
          {l.hour_type === "rework" ? "  ⟲" : ""}
          {l.qty_is_estimated ? "  ~" : ""}
          {photoCount ? `  📷${photoCount > 1 ? photoCount : ""}` : ""}
        </Text>
        <Text style={s.lineMeta} numberOfLines={1}>
          {phaseLabel(l.phase, lang)} · {l.area}
          {!isLabor && l.qty ? ` · ${l.qty} ${l.unit}` : ""}
        </Text>
      </View>
      <Text style={s.lineAmt}>{usd(amount)}</Text>
    </View>
  );
}

export default function TodayScreen({ t, lang, workDate, pending, nav, onFillPhoto, onProjectChange }) {
  const project = currentProject();
  const lines = activeLines(workDate);
  const photos = photosFor(workDate);
  const totals = todayTotals(workDate);
  const status = dayStatus(workDate);
  // Photo-first reality: crews snap, they don't type. Unlinked photos are the
  // day's to-do — each tap opens the material form with the photo attached.
  const inbox = photos.filter((p) => !p.line_id);

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <View style={s.projRow}>
        <View style={{ flex: 1 }}>
          <ProjectPicker
            t={t}
            current={project}
            recents={recentProjects()}
            onSelect={async (p) => {
              await setCurrentProject(p);
              onProjectChange?.();
            }}
          />
          {/* TODAY = the actual date, its own element — never part of the logo. */}
          <Text style={s.dateLine}>
            {t("today")} ·{" "}
            {new Date(workDate + "T12:00:00").toLocaleDateString(
              lang === "es" ? "es-MX" : "en-US",
              { weekday: "short", month: "short", day: "numeric", year: "numeric" }
            )}
            {status !== "draft" ? `  ·  ${t(status === "amended" ? "amended" : "submitted")}` : ""}
          </Text>
        </View>
        {pending > 0 && (
          <View style={s.pendingBadge}>
            <Text style={s.pendingText}>{pending} {t("pending")}</Text>
          </View>
        )}
      </View>

      {!project && (
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <Muted>{t("pickProjectFirst")}</Muted>
        </View>
      )}

      <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 14 }}>
        <BigButton label={t("addMaterial")} onPress={() => nav("item")} disabled={!project} />
        <BigButton label={t("addLabor")} onPress={() => nav("labor")} disabled={!project} />
        <BigButton label={t("addPhoto")} onPress={() => nav("photo")} tone="plain" disabled={!project} />
      </View>

      {inbox.length > 0 && (
        <Card>
          <Text style={s.inboxTitle}>
            📷 {inbox.length} {t("needDetails")}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.inboxRow}>
              {inbox.map((p) => (
                <Pressable
                  key={p.photo_id}
                  onPress={() => onFillPhoto(p)}
                  accessibilityRole="button"
                  accessibilityLabel={t("needDetails")}
                >
                  <Image source={{ uri: p.uri }} style={s.inboxThumb} resizeMode="cover" />
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Muted style={{ marginTop: 8 }}>{t("needDetailsHint")}</Muted>
        </Card>
      )}

      <Card>
        {lines.length === 0 && photos.length === 0 ? (
          <Muted>{t("noEntries")}</Muted>
        ) : (
          <>
            <View style={s.totRow}>
              <Text style={s.totBig}>{usd(totals.money)}</Text>
              <Text style={s.totMeta}>
                {totals.count} {t("lines")} · {totals.hours} {t("laborHours")}
                {photos.length ? ` · ${photos.length} ${t("photosToday")}` : ""}
              </Text>
            </View>
            {lines.map((l) => (
              <LineRow
                key={l.line_id}
                l={l}
                lang={lang}
                photoCount={photos.filter((p) => p.line_id === l.line_id).length}
              />
            ))}
          </>
        )}
      </Card>

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <BigButton
          label={t("review")}
          onPress={() => nav("review")}
          tone="green"
          disabled={lines.length === 0}
        />
        <BigButton label={t("changeOrders")} onPress={() => nav("cos")} tone="plain" />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  projRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  projName: { color: colors.text, fontSize: 16, fontWeight: "800" },
  dateLine: { color: colors.brand, fontSize: 13.5, fontWeight: "700", marginTop: 2 },
  pendingBadge: {
    backgroundColor: "#FEF6E7",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  pendingText: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  totRow: { marginBottom: 10 },
  totBig: { color: colors.text, fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  totMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  classDot: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  classDotText: { fontWeight: "800", fontSize: 14 },
  lineTitle: { color: colors.text, fontSize: 14.5, fontWeight: "600" },
  lineMeta: { color: colors.textMuted, fontSize: 12.5, marginTop: 1 },
  lineAmt: { color: colors.text, fontSize: 14.5, fontWeight: "700", fontVariant: ["tabular-nums"] },
  inboxTitle: { color: colors.text, fontWeight: "800", fontSize: 15, marginBottom: 10 },
  inboxRow: { flexDirection: "row", gap: 8 },
  inboxThumb: {
    width: 74,
    height: 74,
    borderRadius: 10,
    backgroundColor: "#eee",
    borderWidth: 2,
    borderColor: colors.brand,
  },
});
