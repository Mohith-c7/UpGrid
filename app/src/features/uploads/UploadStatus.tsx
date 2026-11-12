import React from 'react';
import { View } from 'react-native';
import { Banner, Button, Icon, ProgressBar, Text } from '@/ui';
import { colors } from '@/theme';
import type { useFileUpload } from './useFileUpload';
import { formatBytes } from './uploadFile';

type Upload = ReturnType<typeof useFileUpload>;

const STAGE_TEXT: Record<string, string> = {
  checking: 'Checking file',
  presign: 'Preparing upload',
  upload: 'Uploading',
  confirm: 'Finishing',
};

/** Progress / error / done display for a `useFileUpload` slot, with Cancel, Retry and Choose another. Renders nothing when idle. */
export function UploadStatus({ upload, onChooseAnother }: { upload: Upload; onChooseAnother?: () => void }) {
  const { phase, stage, progress, file, error } = upload;
  if (phase === 'idle') return null;
  const size = file?.size ? formatBytes(file.size) : null;
  return (
    <View style={{ gap: 12 }}>
      {file ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Icon name={phase === 'done' ? 'check-circle' : phase === 'error' ? 'error-outline' : 'description'} size={24} color={phase === 'done' ? colors.success : phase === 'error' ? colors.error : colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="subhead" numberOfLines={2} ellipsizeMode="middle">{file.name}</Text>
            {size ? <Text variant="caption" color={colors.muted} tabular>{size}</Text> : null}
          </View>
        </View>
      ) : null}

      {phase === 'working' ? (
        <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
          <ProgressBar value={stage === 'upload' ? progress : stage === 'confirm' ? 1 : 0} label={`${STAGE_TEXT[stage ?? 'checking']}${stage === 'upload' ? ` ${Math.round(progress * 100)}%` : '...'}`} />
          <Button label="Cancel upload" variant="secondary" full onPress={upload.cancel} />
        </View>
      ) : null}

      {phase === 'error' && error ? (
        <View style={{ gap: 8 }}>
          <Banner tone="error" message={error.message} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {error.retryable && file ? <Button label="Retry" icon="refresh" size="sm" onPress={upload.retry} /> : null}
            <Button label="Choose another file" size="sm" variant="secondary" onPress={onChooseAnother ?? upload.pick} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
