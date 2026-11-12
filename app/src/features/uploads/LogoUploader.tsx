import React from 'react';
import { View } from 'react-native';
import { Banner, Button, CompanyLogo, Text } from '@/ui';
import { colors } from '@/theme';
import { useFileUpload } from './useFileUpload';
import { UploadStatus } from './UploadStatus';

export interface LogoValue {
  /** send as `company.logoFileId` when saving the drive */
  fileId: string;
  /** public URL from the server (preview); falls back to the local file */
  previewUrl: string;
}

/**
 * Company logo upload for officers (PNG/JPG/WebP, no SVG, server limit from /config, default 1 MB).
 * Controlled by the parent form:
 *   <LogoUploader companyName={name} currentUrl={drive.company.logoUrl} onChange={(v) => setLogo(v)} />
 *   // v = { fileId, previewUrl } after a successful upload, null when the officer removes the logo
 *   // on save: PUT /drives/:id { company: { ..., logoFileId: v ? v.fileId : null } }   (null clears the logo)
 * Renders `fallback` (default nothing) when file uploads are off.
 */
export function LogoUploader({
  companyName,
  currentUrl,
  onChange,
  fallback = null,
  disabled,
}: {
  companyName: string;
  currentUrl?: string | null;
  onChange: (value: LogoValue | null) => void;
  fallback?: React.ReactNode;
  disabled?: boolean;
}) {
  const [removed, setRemoved] = React.useState(false);
  const up = useFileUpload('company_logo', {
    onDone: (file, picked) => {
      setRemoved(false);
      onChange({ fileId: file.id, previewUrl: file.publicUrl ?? picked.uri });
    },
  });
  if (!up.enabled) return <>{fallback}</>;

  const shown = up.phase === 'done' ? (up.result?.publicUrl ?? up.file?.uri ?? null) : removed ? null : (currentUrl ?? null);
  const has = !!shown;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <CompanyLogo name={companyName || 'Company'} logoUrl={shown} size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subhead">Company logo</Text>
          <Text variant="caption" color={colors.muted}>PNG, JPG or WebP, up to {up.limits.logoMb} MB. No SVG.</Text>
        </View>
      </View>
      <UploadStatus upload={up} />
      {up.phase !== 'working' ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {up.phase === 'idle' || up.phase === 'done' ? (
            <Button label={has ? 'Replace logo' : 'Upload logo'} icon="image" size="sm" variant="secondary" disabled={disabled} onPress={up.pick} />
          ) : null}
          {has ? (
            <Button
              label="Remove logo"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onPress={() => {
                up.reset();
                setRemoved(true);
                onChange(null);
              }}
            />
          ) : null}
        </View>
      ) : null}
      {up.phase === 'done' ? <Banner tone="info" message="Logo uploaded. It is applied when you save the drive." /> : null}
    </View>
  );
}
