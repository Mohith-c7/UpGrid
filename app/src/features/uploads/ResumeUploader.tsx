import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { qk } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { addFileResume, deleteFile } from '@/api/integrations';
import type { ResumeEntry, UploadedFile } from '@/api/integrationsTypes';
import { validateText } from '@/lib/validation';
import { useFileUpload } from './useFileUpload';
import { UploadStatus } from './UploadStatus';
import { formatBytes } from './uploadFile';

const stripExt = (n: string) => n.replace(/\.[a-z0-9]+$/i, '').slice(0, 60);

/**
 * Resume upload card: pick a PDF/DOCX -> upload -> name it -> saved as a resume entry (POST /profile/resumes {label, fileId}).
 * Renders `fallback` (default: nothing) when the server has file uploads off.
 */
export function ResumeUploader({
  onSaved,
  isDefault,
  disabled,
  disabledReason,
  fallback = null,
}: {
  /** called after the resume entry exists; the resumes/profile queries are invalidated for you */
  onSaved?: (resume: ResumeEntry | undefined, file: UploadedFile) => void;
  /** make the new resume the default (the server also defaults the first one) */
  isDefault?: boolean;
  /** e.g. when the student already has 5 resumes */
  disabled?: boolean;
  disabledReason?: string;
  fallback?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const up = useFileUpload('resume');
  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef(false);
  const [savingUi, setSavingUi] = useState(false);

  // pre-fill the label from the file name once the upload is done
  useEffect(() => {
    if (up.phase === 'done' && up.file && !label) setLabel(stripExt(up.file.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [up.phase]);

  if (!up.enabled) return <>{fallback}</>;

  const maxMb = up.limits.resumeMb;

  const save = async () => {
    if (saving.current || !up.result) return;
    setSaveError(null);
    const v = validateText(label, { required: true, max: 60, label: 'Label' });
    if (!v.ok) {
      setLabelError(v.error);
      return;
    }
    saving.current = true;
    setSavingUi(true);
    try {
      const entry = await addFileResume({ label: v.value, fileId: up.result.id, ...(isDefault ? { isDefault: true } : {}) });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.resumes }), qc.invalidateQueries({ queryKey: qk.profile })]);
      toast.show('Resume saved', 'success');
      const file = up.result;
      up.reset();
      setLabel('');
      onSaved?.(entry, file);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RESUME_LIMIT') setSaveError('You already have 5 resumes. Delete one to add another.');
      else if (e instanceof ApiError && e.fields?.label) setLabelError(e.fields.label);
      else setSaveError(e instanceof ApiError ? e.message : 'Could not save the resume. Please try again.');
    } finally {
      saving.current = false;
      setSavingUi(false);
    }
  };

  const discard = async () => {
    const id = up.result?.id;
    up.reset();
    setLabel('');
    setSaveError(null);
    if (id) {
      try {
        await deleteFile(id); // frees storage quota; ignore failures
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <Text variant="subhead">Upload a resume file</Text>
      <Text variant="caption" color={colors.muted}>PDF or Word (.docx), up to {maxMb} MB.</Text>
      {disabled ? <Banner tone="warning" message={disabledReason ?? 'You cannot add more resumes right now.'} /> : null}

      {up.phase === 'idle' ? (
        <Button label="Choose file" icon="upload-file" full disabled={disabled} onPress={up.pick} />
      ) : null}

      <UploadStatus upload={up} />

      {up.phase === 'done' && up.result ? (
        <View style={{ gap: 12 }}>
          <Text variant="caption" color={colors.muted} tabular>Uploaded {formatBytes(up.result.size)}. Name it to save.</Text>
          <TextField label="Label" value={label} onChangeText={(t) => { setLabel(t); setLabelError(null); }} error={labelError} maxLength={60} helper="For example: Software roles" />
          {saveError ? <Banner tone="error" message={saveError} /> : null}
          <Button label="Save resume" full loading={savingUi} onPress={save} />
          <Button label="Discard file" variant="ghost" full disabled={savingUi} onPress={discard} />
        </View>
      ) : null}
    </Card>
  );
}
