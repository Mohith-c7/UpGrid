import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Header, OfflineBanner, Screen, SegmentedTabs } from '@/ui';
import { qk } from '@/api/hooks';
import { useBack } from '@/features/student/me/kit';
import { TicketList } from '@/features/support/shared';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

export default function SupportInbox() {
  const router = useRouter();
  const back = useBack('/(officer)/(tabs)/more');
  const qc = useQueryClient();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { await qc.invalidateQueries({ queryKey: qk.tickets }); } finally { setRefreshing(false); }
  };
  return (
    <Screen scroll padded={false} edges={['bottom']} onRefresh={() => { void refresh(); }} refreshing={refreshing}>
      <FocusedStatusBar />
      <Header variant="bar" title="Support inbox" subtitle="Questions and disputes from students" onBack={back} />
      <View style={{ padding: 16, gap: 16 }}>
        <OfflineBanner />
        <SegmentedTabs value={tab} onChange={(v) => setTab(v === 'resolved' ? 'resolved' : 'open')} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }]} />
        <TicketList key={tab} status={tab} showStudent onOpen={(id) => router.push(`/(officer)/support/${id}`)}
          emptyMessage={tab === 'open' ? 'Student questions and disputes appear here.' : 'Resolved tickets appear here.'} />
      </View>
    </Screen>
  );
}
