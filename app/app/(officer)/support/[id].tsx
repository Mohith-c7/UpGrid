import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useBack } from '@/features/student/me/kit';
import ThreadView from '@/features/support/ThreadView';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

export default function OfficerTicket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = useBack('/(officer)/support');
  return (
    <>
      <FocusedStatusBar />
      <ThreadView id={String(id)} onBack={back} officer />
    </>
  );
}
