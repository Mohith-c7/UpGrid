import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { EmptyState, ErrorState, Select, Skeleton } from '@/ui';
import { useRecruiterDrives } from '@/api/recruiter';
import { errMessage } from '@/api/client';
import { flatten } from '@/api/hooks';
import type { RecruiterDriveItem } from '@/api/recruiterTypes';
import { driveSelection, useSelectedDriveId } from './selection';

/** Loads the recruiter's drives and keeps one selected. Renders `children(driveId, drive)` once a drive is known. */
export function DriveScoped({ children, emptyHint }: { children: (driveId: string, drive: RecruiterDriveItem) => React.ReactNode; emptyHint: string }) {
  const q = useRecruiterDrives();
  const selected = useSelectedDriveId();
  const items = useMemo(() => flatten(q.data), [q.data]);
  const current = items.find((d) => d.driveId === selected) ?? items[0];

  useEffect(() => {
    if (current && current.driveId !== selected) driveSelection.set(current.driveId);
  }, [current, selected]);

  if (q.isLoading) return <View style={{ padding: 16, gap: 12 }}><Skeleton height={52} radius={12} /><Skeleton height={96} radius={14} /><Skeleton height={96} radius={14} /></View>;
  if (q.isError) return <View style={{ padding: 16 }}><ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} /></View>;
  if (!current) return <View style={{ padding: 16 }}><EmptyState icon="work-outline" title="No drives assigned" message={emptyHint} actionLabel="Refresh" onAction={() => void q.refetch()} /></View>;
  return (
    <View style={{ flex: 1 }}>
      {items.length > 1 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Select
            label="Drive"
            value={current.driveId}
            onChange={(v) => driveSelection.set(v)}
            options={items.map((d) => ({ value: d.driveId, label: `${d.company.name} - ${d.role}` }))}
          />
        </View>
      ) : null}
      {children(current.driveId, current)}
    </View>
  );
}
