import React, { useEffect, useState } from 'react';
import { Banner, Button, Checkbox, SegmentedControl, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useOpsSettings, useUpdateOpsSettings } from '@/api/ops';
import type { OpsSettings } from '@/api/opsTypes';
import { Async, Group, OpsPage, useOnce } from '@/features/ops/kit';

export default function OpsSettingsScreen() {
  const toast = useToast();
  const q = useOpsSettings();
  const m = useUpdateOpsSettings();
  const [s, setS] = useState<OpsSettings | null>(null);
  const [minGroup, setMinGroup] = useState('5');
  const [dirty, setDirty] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => { if (q.data && !dirty) { setS(q.data); setMinGroup(String(q.data.publicStatsMinGroup)); } }, [q.data, dirty]);
  const patch = (p: Partial<OpsSettings>) => { setS((x) => (x ? { ...x, ...p } : x)); setDirty(true); };

  const [save, saving] = useOnce(async () => {
    if (!s) return;
    const n = Number(minGroup);
    if (!Number.isInteger(n) || n < 5 || n > 100) { setErrs({ publicStatsMinGroup: 'Enter a whole number from 5 to 100' }); return; }
    setErrs({}); setBanner(null);
    try { await m.mutateAsync({ ...s, publicStatsMinGroup: n }); setDirty(false); toast.show('Settings saved', 'success'); }
    catch (e) { setErrs(fieldErrors(e)); setBanner(errMessage(e)); }
  });

  return (
    <OpsPage title="Operations settings" back="/(officer)/ops" keyboard onRefresh={() => { setDirty(false); void q.refetch(); }} refreshing={q.isRefetching}
      footer={s ? <Button label={dirty ? 'Save settings' : 'Saved'} full disabled={!dirty} loading={saving} onPress={() => save()} /> : undefined}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3} rowHeight={120}>
        {s ? (
          <>
            <Group title="Approvals">
              <Text variant="body">Restrictions</Text>
              <SegmentedControl value={s.restrictionApproval} onChange={(v) => patch({ restrictionApproval: v as OpsSettings['restrictionApproval'] })} options={[{ value: 'required', label: 'Second officer approves' }, { value: 'not_required', label: 'Active at once' }]} />
              <Text variant="caption" color={colors.muted}>With approval, a restriction stays pending until a different officer approves it.</Text>
              <Text variant="body">Policy versions</Text>
              <SegmentedControl value={s.policyApproval} onChange={(v) => patch({ policyApproval: v as OpsSettings['policyApproval'] })} options={[{ value: 'required', label: 'Second officer approves' }, { value: 'not_required', label: 'Activate directly' }]} />
              <Text variant="caption" color={colors.muted}>With approval, the author of a version cannot approve it.</Text>
            </Group>
            <Group title="Public statistics for students">
              <Checkbox checked={s.publicStatsEnabled} onChange={(v) => patch({ publicStatsEnabled: v })}>
                <Text variant="body">Show anonymised placement statistics</Text>
                <Text variant="caption" color={colors.muted}>Students see percentages by branch and batch, never names.</Text>
              </Checkbox>
              <TextField label="Smallest group shown" value={minGroup} onChangeText={(t) => { setMinGroup(t.replace(/\D/g, '')); setDirty(true); }} keyboardType="number-pad" maxLength={3}
                error={errs.publicStatsMinGroup} helper="Groups with fewer students are hidden to protect privacy. Minimum 5." editable={s.publicStatsEnabled} />
            </Group>
            {banner ? <Banner tone="error" message={banner} /> : null}
          </>
        ) : null}
      </Async>
    </OpsPage>
  );
}
