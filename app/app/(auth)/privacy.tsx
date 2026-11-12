import React from 'react';
import LegalScreen from '@/features/legal/LegalScreen';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

export default function Privacy() {
  return (
    <>
      <FocusedStatusBar />
      <LegalScreen doc="privacy" />
    </>
  );
}
