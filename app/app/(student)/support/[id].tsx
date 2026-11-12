import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useBack } from '@/features/student/me/kit';
import ThreadView from '@/features/support/ThreadView';

export default function StudentTicket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = useBack('/(student)/support');
  return <ThreadView id={String(id)} onBack={back} />;
}
