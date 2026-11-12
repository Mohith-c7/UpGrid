import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, SectionHeader, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { confirm, Page, sp, QueryBoundary } from '@/features/student/me/kit';
import { errMessage } from '@/api/client';
import { useAiStatus, useDeleteAiData, useSetAiConsent } from '@/api/ai';
import { useFeatures } from '@/config/features';
import { ConsentPanel } from '@/features/ai/kit';
import { formatDateTimeIST } from '@/lib/format';

/** AI privacy: consent text with accept / revoke, and "delete my AI data". Reachable from Profile even if AI is switched off. */
export default function AiConsent() {
  const router = useRouter();
  const toast = useToast();
  const { flags } = useFeatures();
  const status = useAiStatus(flags.ai === true);
  const del = useDeleteAiData();
  const revoke = useSetAiConsent();
  const [error, setError] = React.useState<string | null>(null);
  const granted = status.data?.consent.granted === true;

  const deleteData = () =>
    confirm('Delete my AI data?', 'This permanently deletes your AI conversations, mock interviews and cached AI results. Personalisation will be turned off.', 'Delete', async () => {
      setError(null);
      try {
        if (granted) await revoke.mutateAsync({ granted: false, deleteData: true });
        const r = await del.mutateAsync();
        const d = r?.deleted;
        toast.show(d ? `Deleted ${d.conversations} conversations and ${d.mockInterviews} mock interviews` : 'AI data deleted', 'success');
      } catch (e) {
        setError(errMessage(e));
      }
    });

  return (
    <Page title="AI privacy" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/profile' as never))} onRefresh={() => status.refetch()} refreshing={status.isRefetching}>
      {flags.ai !== true ? (
        <Banner tone="info" message="AI tools are not switched on for your college right now. Your choices here apply when they are." />
      ) : (
        <QueryBoundary isLoading={status.isLoading} isError={status.isError} error={status.error} onRetry={() => status.refetch()} skeletonRows={2} skeletonHeight={140}>
          {status.data ? (
            <View style={{ gap: sp.xl }}>
              <Card tinted>
                <Text variant="subhead">{granted ? 'Personalisation is on' : 'Personalisation is off'}</Text>
                <Text variant="caption" color={colors.muted}>
                  {granted && status.data.consent.grantedAt ? `Since ${formatDateTimeIST(status.data.consent.grantedAt)}` : 'The assistant uses only general placement knowledge.'}
                </Text>
              </Card>
              <ConsentPanel granted={granted} />
              <View style={{ gap: sp.md }}>
                <SectionHeader title="Your AI data" subtitle="Conversations and mock interviews are saved so you can reopen them." />
                <Card>
                  <View style={{ gap: sp.md }}>
                    <Text variant="body" color={colors.textSecondary}>Delete everything the AI tools stored about you. This cannot be undone.</Text>
                    {error ? <Banner tone="error" message={error} /> : null}
                    <Button label="Delete my AI data" variant="danger" icon="delete-outline" full loading={del.isPending || revoke.isPending} onPress={deleteData} />
                  </View>
                </Card>
              </View>
            </View>
          ) : null}
        </QueryBoundary>
      )}
    </Page>
  );
}
