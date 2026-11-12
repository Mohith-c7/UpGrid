import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, ProgressBar, SectionHeader, Text } from '@/ui';
import { colors } from '@/theme';
import { useProfile } from '@/api/hooks';
import { useFeature } from '@/config/features';
import { isMissingRoute, useMyDocuments } from '@/api/studentExtras';
import { Page, QueryBoundary, VerificationBadge, sp } from '@/features/student/me/kit';
import { formatDateIST } from '@/lib/format';

const ROWS: { key: string; label: string; value: (a: any, i: any) => string; route: string }[] = [
  { key: 'identity.registrationNumber', label: 'Registration number', value: (_a, i) => i?.registrationNumber ?? '', route: '/(student)/profile/edit-identity' },
  { key: 'academics.department', label: 'Department', value: (a) => a?.department ?? '', route: '/(student)/profile/edit-academics' },
  { key: 'academics.batchYear', label: 'Batch year', value: (a) => (a?.batchYear ? String(a.batchYear) : ''), route: '/(student)/profile/edit-academics' },
  { key: 'academics.cgpa', label: 'CGPA', value: (a) => (a?.cgpa != null ? `${Number(a.cgpa).toFixed(2)} / ${a.cgpaScale ?? 10}` : ''), route: '/(student)/profile/edit-academics' },
  { key: 'academics.tenthPercent', label: '10th percentage', value: (a) => (a?.tenthPercent != null ? `${a.tenthPercent}%` : ''), route: '/(student)/profile/edit-academics' },
  { key: 'academics.twelfthPercent', label: '12th percentage', value: (a) => (a?.twelfthPercent != null ? `${a.twelfthPercent}%` : ''), route: '/(student)/profile/edit-academics' },
  { key: 'academics.activeBacklogs', label: 'Active backlogs', value: (a) => (a?.activeBacklogs != null ? String(a.activeBacklogs) : ''), route: '/(student)/profile/edit-academics' },
];
const DOC_LABEL: Record<string, string> = { marksheet: 'Marksheet', id_proof: 'ID proof', resume: 'Resume', certificate: 'Certificate', offer_letter: 'Offer letter', other: 'Other document' };

/** What the placement cell has verified so far: profile fields (from GET /profile) and documents (GET /documents/mine). */
export default function VerificationScreen() {
  const router = useRouter();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/profile' as never)), [router]);
  const profile = useProfile();
  const docsOn = useFeature('opsDocuments');
  const docs = useMyDocuments(docsOn);
  const p = profile.data;
  const filled = ROWS.filter((r) => r.value(p?.academics, p?.identity));
  const verifiedN = filled.filter((r) => p?.verification?.[r.key] === 'verified').length;
  const docsMissing = docs.isError && isMissingRoute(docs.error);

  return (
    <Page title="Verification status" onBack={back} onRefresh={() => { void profile.refetch(); if (docsOn) void docs.refetch(); }} refreshing={profile.isRefetching} gap={sp.xl}>
      <QueryBoundary isLoading={profile.isLoading} isError={profile.isError} error={profile.error} onRetry={() => void profile.refetch()} skeletonRows={3} skeletonHeight={110}>
        <View style={{ gap: sp.xl }}>
          <Banner tone="info" message="The placement cell checks your details by hand. Editing a verified value makes it unverified again until it is re-checked." />

          <View style={{ gap: sp.md }}>
            <SectionHeader title="Profile details" subtitle={`${verifiedN} of ${filled.length} verified`} />
            <ProgressBar value={filled.length ? verifiedN / filled.length : 0} label={`${verifiedN} of ${filled.length} profile details verified`} />
            <Card>
              <View style={{ gap: sp.lg }}>
                {filled.length === 0 ? <Text variant="body" color={colors.muted}>Add your academic details first. Then the placement cell can verify them.</Text> : null}
                {filled.map((r) => (
                  <View key={r.key} style={{ gap: sp.xs }}>
                    <Text variant="caption" color={colors.muted}>{r.label}</Text>
                    <Text variant="body" tabular style={{ fontWeight: '600' }}>{r.value(p?.academics, p?.identity)}</Text>
                    <VerificationBadge v={p?.verification?.[r.key]} />
                  </View>
                ))}
                <Button label="Edit academics" size="sm" variant="secondary" icon="edit" onPress={() => router.push('/(student)/profile/edit-academics' as never)} />
              </View>
            </Card>
          </View>

          {docsOn && !docsMissing ? (
            <View style={{ gap: sp.md }}>
              <SectionHeader title="Documents" subtitle={docs.data?.completion ? `${Math.round(docs.data.completion.percent)}% of required documents verified` : undefined} />
              <QueryBoundary
                isLoading={docs.isLoading} isError={docs.isError} error={docs.error} onRetry={() => void docs.refetch()}
                isEmpty={(docs.data?.items ?? []).length === 0}
                empty={{ title: 'No documents submitted', message: `The placement cell may ask for: ${(docs.data?.completion?.required ?? ['marksheet', 'id_proof', 'resume']).map((d) => DOC_LABEL[d] ?? d).join(', ')}.` }}
                skeletonRows={2} skeletonHeight={90}
              >
                <View style={{ gap: sp.md }}>
                  {(docs.data?.items ?? []).map((d) => (
                    <Card key={d.id}>
                      <View style={{ gap: sp.sm }}>
                        <Text variant="subhead" numberOfLines={2}>{d.label}</Text>
                        <Text variant="caption" color={colors.muted}>{DOC_LABEL[d.docType] ?? d.docType}</Text>
                        <View style={{ flexDirection: 'row' }}>
                          {d.status === 'verified' ? <Badge label="Verified" tone="success" icon="verified" />
                            : d.status === 'rejected' ? <Badge label="Rejected" tone="error" icon="block" />
                            : <Badge label="Waiting for review" tone="warning" icon="hourglass-empty" />}
                        </View>
                        {d.status === 'rejected' && d.rejectReason ? <Text variant="body" color={colors.error}>{`Reason: ${d.rejectReason}`}</Text> : null}
                        {d.reviewedAt ? <Text variant="caption" tabular color={colors.muted}>{`Reviewed ${formatDateIST(d.reviewedAt)}`}</Text> : null}
                      </View>
                    </Card>
                  ))}
                </View>
              </QueryBoundary>
            </View>
          ) : null}
        </View>
      </QueryBoundary>
    </Page>
  );
}
