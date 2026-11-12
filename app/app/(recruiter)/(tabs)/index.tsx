import React, { useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Card, CompanyLogo, EmptyState, ErrorState, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { flatten } from '@/api/hooks';
import { useRecruiterDrives } from '@/api/recruiter';
import type { RecruiterDriveItem } from '@/api/recruiterTypes';
import { formatDateIST } from '@/lib/format';
import { driveSelection } from '@/features/recruiter/selection';
import { Page, SkeletonList } from '@/features/recruiter/kit';

function DriveRow({ d, onPress }: { d: RecruiterDriveItem; onPress: () => void }) {
  const closed = d.status === 'closed';
  return (
    <Card onPress={onPress} accessibilityLabel={`${d.company.name}, ${d.role}`} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <CompanyLogo name={d.company.name} logoUrl={d.company.logoUrl} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subhead" numberOfLines={2}>{d.role}</Text>
          <Text variant="caption" color={colors.muted} numberOfLines={1}>{d.company.name}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Badge label={closed ? 'Closed' : d.status === 'published' || d.status === 'open' ? 'Open' : d.status.replace(/_/g, ' ')} tone={closed ? 'neutral' : 'success'} />
        {d.deadline ? <Badge label={`Deadline ${formatDateIST(d.deadline)}`} tone="neutral" icon="event" /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 }}>
        {[
          ['Candidates', d.counts.candidates], ['Shortlisted', d.counts.shortlisted], ['In rounds', d.counts.inRounds], ['Offers', d.counts.offers],
        ].map(([label, n]) => (
          <Text key={label as string} variant="caption" color={colors.muted} tabular>
            <Text variant="caption" tabular style={{ fontWeight: '700' }}>{n as number}</Text> {label as string}
          </Text>
        ))}
      </View>
    </Card>
  );
}

export default function RecruiterDrives() {
  const router = useRouter();
  const q = useRecruiterDrives();
  const items = useMemo(() => flatten(q.data), [q.data]);

  let body: React.ReactNode;
  if (q.isLoading) body = <View style={{ padding: 16 }}><SkeletonList rows={3} height={150} /></View>;
  else if (q.isError && !items.length) body = <View style={{ padding: 16 }}><ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} /></View>;
  else
    body = (
      <FlatList
        data={items}
        keyExtractor={(d) => d.driveId}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} colors={[colors.primary]} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <DriveRow d={item} onPress={() => { driveSelection.set(item.driveId); router.push(`/(recruiter)/drive/${item.driveId}` as never); }} />
        )}
        ListEmptyComponent={
          <EmptyState icon="work-outline" title="No drives assigned yet" message="When a placement officer adds you to a drive it shows up here." actionLabel="Refresh" onAction={() => void q.refetch()} />
        }
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
      />
    );
  return <Page title="My drives" scroll={false}>{body}</Page>;
}
