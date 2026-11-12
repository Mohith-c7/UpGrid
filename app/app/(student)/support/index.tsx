import React from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Text } from '@/ui';
import { colors } from '@/theme';
import { qk } from '@/api/hooks';
import { Page, useBack } from '@/features/student/me/kit';
import { TicketList } from '@/features/support/shared';

export default function HelpAndSupport() {
  const router = useRouter();
  const back = useBack('/(student)/(tabs)/profile');
  const qc = useQueryClient();
  return (
    <Page title="Help and support" onBack={back} onRefresh={() => { void qc.invalidateQueries({ queryKey: qk.tickets }); }} refreshing={false}>
      <Text variant="body" color={colors.muted}>Ask the placement cell about your profile, eligibility, an application or a document. Replies appear here.</Text>
      <Button label="New ticket" icon="add" full onPress={() => router.push('/(student)/support/new' as never)} />
      <TicketList
        onOpen={(id) => router.push(`/(student)/support/${id}` as never)}
        emptyMessage="Problems with your profile, eligibility, an application or a document can be sent to the placement cell here."
        emptyActionLabel="New ticket"
        onEmptyAction={() => router.push('/(student)/support/new' as never)}
      />
    </Page>
  );
}
