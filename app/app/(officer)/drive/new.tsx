import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DriveStepper } from '../../../src/features/officer/stepper/DriveStepper';

export default function NewDrive() {
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();
  return <DriveStepper key={draftId ?? 'new'} draftId={draftId} />;
}
