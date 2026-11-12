import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorState, Header, Icon, OfflineBanner, ProgressBar, Screen, SectionHeader, Sheet, Skeleton, Text, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { errMessage, useInvalidateOfficer, useStudent, verifyStudent } from '@/features/officer/data';
import { AppStatusBadge, useOnce, VERIF_BADGE } from '@/features/officer/components/common';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

const FIELDS: { key: string; label: string; group: 'academics' | 'identity'; suffix?: string; decimals?: number }[] = [
  { key: 'registrationNumber', label: 'Registration number', group: 'identity' },
  { key: 'university', label: 'University', group: 'academics' },
  { key: 'department', label: 'Department', group: 'academics' },
  { key: 'batchYear', label: 'Batch year', group: 'academics' },
  { key: 'cgpa', label: 'CGPA', group: 'academics', decimals: 2 },
  { key: 'tenthPercent', label: '10th %', group: 'academics', suffix: '%' },
  { key: 'twelfthPercent', label: '12th %', group: 'academics', suffix: '%' },
  { key: 'activeBacklogs', label: 'Active backlogs', group: 'academics' },
  { key: 'gapYears', label: 'Gap years', group: 'academics' },
];

function unwrap(raw: any): { value: any; verification?: string } {
  if (raw && typeof raw === 'object' && 'value' in raw) return { value: raw.value, verification: raw.verification };
  return { value: raw };
}
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
function show(v: unknown, f: { suffix?: string; decimals?: number }) {
  if (!has(v)) return 'Not provided';
  const n = typeof v === 'number' ? v : Number(v);
  const base = f.decimals != null && Number.isFinite(n) ? n.toFixed(f.decimals) : String(v);
  return f.suffix ? `${base}${f.suffix}` : base;
}

export default function StudentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateOfficer();
  const q = useStudent(id);
  const s = q.data;
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const goBack = () => (r.canGoBack() ? r.back() : r.replace('/(officer)/(tabs)/students'));

  const rows = useMemo(() => {
    if (!s) return [];
    return FIELDS.map((f) => {
      const u = unwrap(s[f.group]?.[f.key]);
      const verification = u.verification ?? s.verification?.[`${f.group}.${f.key}`];
      return { ...f, id: `${f.group}.${f.key}`, value: u.value, verification: verification as string | undefined };
    });
  }, [s]);

  const verifiable = rows.filter((x) => has(x.value) && x.verification !== 'verified');
  const verifiableIds = verifiable.map((x) => x.id);
  // drop stale picks after a refetch marks a field verified
  const picks = selected.filter((k) => verifiableIds.includes(k));
  const toggle = (k: string) => setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const [verify, busy] = useOnce(async (fields: string[]) => {
    if (!fields.length) return;
    try {
      await verifyStudent(id!, fields);
      setSelected([]); setConfirmAll(false); void invalidate();
      toast.show(`${fields.length} field${fields.length > 1 ? 's' : ''} verified`, 'success');
    } catch (e) { toast.show(errMessage(e), 'error'); }
  });

  const apps: any[] = Array.isArray(s?.applications) ? s.applications : [];
  const name: string = s?.name ?? s?.identity?.name ?? 'Student';
  const phone = s?.phone ? String(s.phone) : '';
  const completion = s?.completion?.percent;

  const footer = s && verifiable.length > 0 ? (
    <>
      <Button label={picks.length ? `Verify ${picks.length} selected` : 'Select fields to verify'} icon="verified" full loading={busy} disabled={busy || picks.length === 0} onPress={() => verify(picks)} />
      <Button label="Verify all unverified" variant="secondary" full disabled={busy} onPress={() => setConfirmAll(true)} />
    </>
  ) : undefined;

  return (
    <Screen scroll padded={false} edges={['bottom']} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching} footer={footer}>
      <FocusedStatusBar />
      <Header variant="bar" title="Student" onBack={goBack} />
      <View style={{ padding: 16, gap: 16 }}>
        <OfflineBanner />
        {q.isLoading ? (
          <><Skeleton height={140} radius={14} /><Skeleton height={400} radius={14} /><Skeleton height={96} radius={14} /></>
        ) : q.isError || !s ? (
          <ErrorState message={errMessage(q.error)} onRetry={() => { void q.refetch(); }} />
        ) : (
          <>
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <Avatar name={name} size={56} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="title" numberOfLines={2}>{name}</Text>
                  {s.email ? <Text variant="caption" color={colors.muted} numberOfLines={1} ellipsizeMode="tail">{s.email}</Text> : null}
                  {phone ? <Text variant="caption" color={colors.muted} tabular>{phone.length === 10 ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : phone}</Text> : null}
                </View>
              </View>
              {typeof completion === 'number' ? <ProgressBar value={completion} label={`Profile ${Math.round(completion)}% complete`} /> : null}
            </Card>

            <SectionHeader title="Academic details" subtitle={verifiable.length ? 'Tick the fields you have checked, then verify.' : undefined} />
            <Card padding={0} style={{ paddingHorizontal: 16 }}>
              {rows.map((f, i) => {
                const canVerify = has(f.value) && f.verification !== 'verified';
                const isSel = picks.includes(f.id);
                const last = i === rows.length - 1;
                const text = show(f.value, f);
                const inner = (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 }}>
                    {canVerify ? <Icon name={isSel ? 'check-box' : 'check-box-outline-blank'} size={26} color={isSel ? colors.primary : colors.muted} /> : null}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="caption" color={colors.muted}>{f.label}</Text>
                      <Text variant="subhead" tabular numberOfLines={2} color={has(f.value) ? colors.ink : colors.muted} style={{ fontWeight: has(f.value) ? '600' : '400' }}>{text}</Text>
                    </View>
                    {f.verification === 'verified' ? <Badge label="Verified" tone="success" icon="verified" />
                      : canVerify ? <Badge label={f.verification === 'student_confirmed' ? 'Student confirmed' : 'Unverified'} tone="warning" icon="hourglass-empty" />
                      : <Badge label="Missing" tone="neutral" icon="remove-circle-outline" />}
                  </View>
                );
                const border = { borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border } as const;
                return canVerify ? (
                  <Pressable key={f.id} onPress={() => toggle(f.id)} accessibilityRole="checkbox" accessibilityState={{ checked: isSel }} accessibilityLabel={`${f.label}: ${text}. Unverified`}
                    style={({ pressed }) => [border, { minHeight: MIN_TOUCH }, pressed ? { backgroundColor: colors.pressed } : null]}>{inner}</Pressable>
                ) : <View key={f.id} style={border}>{inner}</View>;
              })}
            </Card>
            {verifiable.length === 0 ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{VERIF_BADGE('verified')}<Text variant="caption" color={colors.muted}>Nothing left to verify</Text></View> : null}

            <SectionHeader title="Applications" />
            {apps.length === 0 ? (
              <EmptyState icon="assignment" title="No applications yet" message="Eligibility is shown per drive on the drive screen." />
            ) : (
              <View style={{ gap: 10 }}>
                {apps.map((a, i) => {
                  const company = typeof a.company === 'object' ? a.company?.name : a.company;
                  return (
                    <Card key={a.id ?? `${a.driveId}-${i}`} onPress={a.driveId ? () => r.push(`/(officer)/drive/${a.driveId}`) : undefined} accessibilityLabel={`${company ?? 'Drive'}, ${a.role ?? ''}`} style={{ gap: 10 }}>
                      <View>
                        <Text variant="subhead" numberOfLines={1} ellipsizeMode="tail">{company ?? 'Drive'}</Text>
                        {a.role ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{a.role}</Text> : null}
                      </View>
                      <View style={{ flexDirection: 'row' }}><AppStatusBadge status={a.status ?? 'unknown'} /></View>
                    </Card>
                  );
                })}
              </View>
            )}

            {(s.links?.linkedin || s.links?.github || s.skills?.length) ? (
              <>
                <SectionHeader title="Profile" />
                <Card style={{ gap: 12 }}>
                  {s.skills?.length ? (
                    <View style={{ gap: 6 }}>
                      <Text variant="caption" color={colors.muted}>Skills</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{s.skills.map((k: string) => <Chip key={k} label={k} />)}</View>
                    </View>
                  ) : null}
                  {s.links?.linkedin ? <View><Text variant="caption" color={colors.muted}>LinkedIn</Text><Text variant="body" selectable>{s.links.linkedin}</Text></View> : null}
                  {s.links?.github ? <View><Text variant="caption" color={colors.muted}>GitHub</Text><Text variant="body" selectable>{s.links.github}</Text></View> : null}
                </Card>
              </>
            ) : null}
          </>
        )}
      </View>

      <Sheet visible={confirmAll} onClose={() => setConfirmAll(false)} title="Verify all fields?">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Text variant="body" tabular>{verifiable.length} {verifiable.length === 1 ? 'field' : 'fields'} will be marked as checked by the placement cell. Do this only after checking marksheets or university records.</Text>
          <Button label="Verify all" full loading={busy} onPress={() => verify(verifiableIds)} />
          <Button label="Cancel" variant="secondary" full onPress={() => setConfirmAll(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
