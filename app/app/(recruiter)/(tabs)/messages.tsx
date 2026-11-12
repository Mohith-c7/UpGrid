import React from 'react';
import { DriveScoped } from '@/features/recruiter/DrivePicker';
import { Page } from '@/features/recruiter/kit';
import { MessageThread } from '@/features/recruiter/MessageThread';

export default function MessagesTab() {
  return (
    <Page title="Messages" scroll={false}>
      <DriveScoped emptyHint="Each drive has a thread with the placement cell and the other recruiters.">
        {(driveId) => <MessageThread key={driveId} driveId={driveId} />}
      </DriveScoped>
    </Page>
  );
}
