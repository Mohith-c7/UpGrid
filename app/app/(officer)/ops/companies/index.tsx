import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Badge, Banner, Card, Chip, CompanyLogo, HeaderAction, SearchBar, Sheet, Text } from '@/ui';
import { colors } from '@/theme';
import { fetchCrmExport, flattenPages, useCrmCompanies, useCrmDuplicates } from '@/api/ops';
import { stageLabel, stageTone, STAGES } from '@/features/ops/crm';
import { Async, ChipRow, LoadMore, OpsPage, stamp, useGo, useShareFile } from '@/features/ops/kit';
import { formatDateIST } from '@/lib/format';

export default function Companies() {
  const go = useGo();
  const share = useShareFile();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [stage, setStage] = useState('');
  const [dupOpen, setDupOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const list = useCrmCompanies({ q: dq || undefined, stage: stage || undefined });
  const dups = useCrmDuplicates();
  const items = flattenPages(list.data);
  const dupIds = useMemo(() => new Set((dups.data ?? []).flatMap((g) => g.companies.map((c) => c.id))), [dups.data]);

  return (
    <OpsPage title="Company CRM" back="/(officer)/ops" onRefresh={() => { void list.refetch(); void dups.refetch(); }} refreshing={list.isRefetching}
      right={<>
        <HeaderAction icon="ios-share" label="Export companies CSV" onPress={() => void share(fetchCrmExport, `companies-${stamp()}.csv`, 'text/csv', 'Export companies')} />
        <HeaderAction icon="add" label="Add company" onPress={() => go('/(officer)/ops/companies/new')} />
      </>}>
      {(dups.data?.length ?? 0) > 0 ? (
        <Banner tone="warning" title={`${dups.data!.length} possible ${dups.data!.length === 1 ? 'duplicate' : 'duplicates'}`} message="Some companies share a name or website. Review and delete the extra records."
          action={{ label: 'Review', onPress: () => setDupOpen(true) }} />
      ) : null}
      <SearchBar value={q} onChangeText={setQ} placeholder="Search companies" />
      <ChipRow>
        <Chip label="All stages" selected={stage === ''} onPress={() => setStage('')} />
        {STAGES.map((s) => <Chip key={s.value} label={s.label} selected={stage === s.value} onPress={() => setStage(s.value)} />)}
      </ChipRow>
      <Async isLoading={list.isLoading} isError={list.isError} error={list.error} onRetry={() => void list.refetch()} isEmpty={items.length === 0}
        empty={{ icon: 'business', title: dq || stage ? 'No companies match' : 'No companies yet', message: dq || stage ? 'Try a different search or stage.' : 'Add the companies you are in touch with.', actionLabel: dq || stage ? undefined : 'Add company', onAction: () => go('/(officer)/ops/companies/new') }} rowHeight={96}>
        {items.map((c) => (
          <Card key={c.id} onPress={() => go(`/(officer)/ops/companies/${c.id}`)} accessibilityLabel={`${c.name}, ${stageLabel(c.stage)}`} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <CompanyLogo name={c.name} size={44} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="subhead" numberOfLines={2}>{c.name}</Text>
                <Text variant="caption" color={colors.muted} numberOfLines={1}>{[c.industry, c.hq].filter(Boolean).join(' · ') || 'No details yet'}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Badge label={stageLabel(c.stage)} tone={stageTone(c.stage)} />
              {c.verified ? <Badge label="Verified" tone="success" icon="verified" /> : null}
              {dupIds.has(c.id) ? <Badge label="Possible duplicate" tone="warning" /> : null}
            </View>
            <Text variant="caption" tabular color={colors.muted}>
              {c.driveCount} {c.driveCount === 1 ? 'drive' : 'drives'}{c.lastInteractionAt ? ` · Last contact ${formatDateIST(c.lastInteractionAt)}` : ' · No contact logged'}{c.nextFollowUpAt ? ` · Follow up ${formatDateIST(c.nextFollowUpAt)}` : ''}
            </Text>
          </Card>
        ))}
        <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />
      </Async>
      <Sheet visible={dupOpen} onClose={() => setDupOpen(false)} title="Possible duplicates">
        <View style={{ gap: 12, paddingBottom: 16 }}>
          {dups.data?.map((g) => (
            <Card key={g.key} padding={12} style={{ gap: 4 }}>
              {g.companies.map((c) => (
                <Text key={c.id} variant="body" onPress={() => { setDupOpen(false); go(`/(officer)/ops/companies/${c.id}`); }} accessibilityRole="link" style={{ minHeight: 48, textAlignVertical: 'center', color: colors.primary }}>
                  {c.name}{c.website ? ` (${c.website})` : ''}
                </Text>
              ))}
            </Card>
          ))}
        </View>
      </Sheet>
    </OpsPage>
  );
}
