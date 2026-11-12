import React from 'react';
import { useRouter } from 'expo-router';
import { CandidateList } from '@/features/recruiter/CandidateList';
import { DriveScoped } from '@/features/recruiter/DrivePicker';
import { Page } from '@/features/recruiter/kit';

export default function CandidatesTab() {
  const router = useRouter();
  return (
    <Page title="Candidates" scroll={false}>
      <DriveScoped emptyHint="Candidates appear once you are assigned to a drive.">
        {(driveId) => <CandidateList driveId={driveId} onOpen={(appId) => router.push(`/(recruiter)/drive/${driveId}/candidate/${appId}` as never)} />}
      </DriveScoped>
    </Page>
  );
}
