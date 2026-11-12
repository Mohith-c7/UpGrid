import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useForm } from 'react-hook-form';
import { Badge, Banner, Button, Card, Icon, SectionHeader, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { validateText, validateUrl } from '@/lib/validation';
import { useRouter } from 'expo-router';
import { useFeature } from '@/config/features';
import { ResumeUploader } from '@/features/uploads';
import { OpenResumeButton, isFileResume, resumeSubtitle, type ResumeLike } from '@/features/studentExtras/resumeOpen';
import { errCode, errFields, errMessage, useResumeMutations, useResumes } from '@/features/student/me/data';
import { confirm, makeResolver, Page, QueryBoundary, RHFText, sp, useBack, useOnce, useUnsavedGuard } from '@/features/student/me/kit';

const MAX = 5;
interface FV { label: string; url: string }
const resolver = makeResolver<FV>({
  label: (v) => { const r = validateText(v ?? '', { required: true, max: 60, label: 'Label' }); return r.ok ? null : r.error; },
  url: (v) => { const r = validateUrl(v ?? '', 'any', true); return r.ok ? null : r.error; },
});

export default function ResumesScreen() {
  const toast = useToast();
  const router = useRouter();
  const uploadsOn = useFeature('fileUploads');
  const back = useBack('/(student)/(tabs)/profile');
  const q = useResumes();
  const m = useResumeMutations();
  const list = q.data ?? [];
  const full = list.length >= MAX;
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const { control, handleSubmit, formState, reset } = useForm<FV>({ resolver, mode: 'onBlur', defaultValues: { label: '', url: '' } });
  useUnsavedGuard(formState.isDirty);
  const rowLock = useRef<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const [add, adding] = useOnce(async (v: FV) => {
    setServerErr({});
    try {
      await m.add.mutateAsync({ label: v.label.trim(), url: v.url.trim() });
      reset({ label: '', url: '' });
      toast.show('Resume link added', 'success');
    } catch (e) {
      if (errCode(e) === 'RESUME_LIMIT') {
        toast.show('You already have 5 resume links. Delete one to add another.', 'error');
        q.refetch();
        return;
      }
      const f = errFields(e);
      if (f) { const mm: Record<string, string> = {}; for (const [k, msg] of Object.entries(f)) mm[k.split('.').pop()!] = msg; setServerErr(mm); }
      toast.show(errMessage(e), 'error');
    }
  });

  const rowAction = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    if (rowLock.current) return;
    rowLock.current = id;
    setRowBusy(id);
    try { await fn(); toast.show(ok); } catch (e) { toast.show(errMessage(e), 'error'); q.refetch(); }
    finally { rowLock.current = null; setRowBusy(null); }
  };

  return (
    <Page title="Resumes" onBack={back} keyboard onRefresh={() => q.refetch()} refreshing={q.isRefetching} gap={sp.xl}>
      <Banner
        tone="info"
        message={uploadsOn
          ? `Upload a PDF or Word file, or save a view-only https link (test it while logged out). You can save ${MAX} in total; the default is sent when you apply unless you pick another.`
          : `File upload is off on this server, so Placement OS stores links only. Use a view-only https link (for example from your cloud drive) and test it while logged out. You can save ${MAX}; the default is sent when you apply unless you pick another.`}
      />
      <View style={{ gap: sp.md }}>
        <SectionHeader title={`Saved (${list.length}/${MAX})`} />
        <QueryBoundary
          isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()}
          isEmpty={list.length === 0}
          empty={{ title: 'No resumes yet', message: uploadsOn ? 'Upload a file or add a link below. You need at least one to apply to a drive.' : 'Add a link below. You need at least one to apply to a drive.' }}
          skeletonRows={2} skeletonHeight={120}
        >
          <View style={{ gap: sp.md }}>
            {list.map((row) => {
              const r = row as unknown as ResumeLike & { id: string; label: string; isDefault: boolean };
              const file = isFileResume(r);
              return (
              <Card key={r.id}>
                <View style={{ gap: sp.md }}>
                  <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' }}>
                    <Icon name={file ? 'picture-as-pdf' : 'link'} size={24} color={colors.primary} />
                    <View style={{ flex: 1, minWidth: 0, gap: sp.xs }}>
                      <Text variant="subhead" numberOfLines={2} ellipsizeMode="tail">{r.label}</Text>
                      <Text variant="caption" color={colors.muted} numberOfLines={2} ellipsizeMode="middle">{resumeSubtitle(r)}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                        <Badge label={file ? 'File' : 'Link'} tone="neutral" icon={file ? 'insert-drive-file' : 'link'} />
                        {r.isDefault ? <Badge label="Default" tone="success" icon="star" /> : null}
                      </View>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap' }}>
                    <OpenResumeButton resume={r} />
                    {!r.isDefault ? (
                      <Button label="Make default" size="sm" variant="secondary" loading={rowBusy === r.id} disabled={!!rowBusy}
                        onPress={() => rowAction(r.id, () => m.setDefault.mutateAsync(r.id), 'Default resume updated')} />
                    ) : null}
                    <Button label="Delete" size="sm" variant="danger" icon="delete-outline" disabled={!!rowBusy}
                      onPress={() => confirm(file ? 'Delete this resume file?' : 'Delete this resume link?',
                        r.isDefault && list.length > 1 ? 'This is your default. The oldest remaining link becomes the default. Applications you already sent are not affected.' : 'Applications you already sent are not affected.',
                        'Delete', () => rowAction(r.id, () => m.remove.mutateAsync(r.id), file ? 'Resume file deleted' : 'Resume link deleted'))} />
                  </View>
                </View>
              </Card>
              );
            })}
          </View>
        </QueryBoundary>
      </View>

      {uploadsOn ? (
        <View style={{ gap: sp.md }}>
          <SectionHeader title="Upload a file" />
          <ResumeUploader disabled={full} disabledReason={`You have reached the limit of ${MAX} resumes. Delete one to add another.`} isDefault={list.length === 0} />
        </View>
      ) : null}

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Build one" />
        <Card onPress={() => router.push('/(student)/resume-builder' as never)} accessibilityLabel="Open the resume builder">
          <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
            <Icon name="edit-note" size={24} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="subhead">Resume builder</Text>
              <Text variant="caption" color={colors.muted}>Make a clean, ATS-friendly PDF from your profile.</Text>
            </View>
            <Icon name="chevron-right" size={24} color={colors.muted} />
          </View>
        </Card>
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Add a resume link" />
        {full ? (
          <Banner tone="warning" message={`You have reached the limit of ${MAX} links. Delete one to add another.`} />
        ) : (
          <Card>
            <View style={{ gap: sp.lg }}>
              <RHFText control={control} name="label" label="Label" helper="For example: Software roles" maxLength={60} serverError={serverErr.label} />
              <RHFText control={control} name="url" label="Link (https)" keyboardType="url" maxLength={300} serverError={serverErr.url} />
              <Button label="Add resume link" icon="add" full loading={adding} onPress={handleSubmit(add, () => toast.show('Fix the highlighted fields', 'error'))} />
            </View>
          </Card>
        )}
      </View>
    </Page>
  );
}
