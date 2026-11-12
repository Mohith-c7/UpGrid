import React from 'react';
import { View } from 'react-native';
import { Banner, Button, Sheet, SegmentedControl, Text, TextField } from '@/ui';
import { colors, spacing } from '@/theme';
import { useAnnouncementDraft } from '@/api/ai';
import { AiErrorBanner } from './kit';

export interface AnnouncementDraftButtonProps {
  /** Drive whose facts the AI may use (optional). */
  driveId?: string;
  /** Receives the officer-edited title and body when they tap "Use this draft". The AI never sends anything. */
  onUse: (draft: { title: string; body: string }) => void;
  label?: string;
  disabled?: boolean;
}

const TONES = [{ value: 'neutral', label: 'Neutral' }, { value: 'friendly', label: 'Friendly' }, { value: 'urgent', label: 'Urgent' }];

/** Button that opens a sheet: enter bullet points, get an editable announcement draft, then hand it to the host form. */
export function AnnouncementDraftButton({ driveId, onUse, label = 'Draft with AI', disabled }: AnnouncementDraftButtonProps) {
  const m = useAnnouncementDraft();
  const [open, setOpen] = React.useState(false);
  const [points, setPoints] = React.useState('');
  const [tone, setTone] = React.useState<'neutral' | 'urgent' | 'friendly'>('neutral');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [drafted, setDrafted] = React.useState(false);

  const ok = points.trim().length >= 5 && points.trim().length <= 1500;
  const generate = async () => {
    try {
      const r = await m.mutateAsync({ points: points.trim(), driveId, tone });
      setTitle(r.announcement.title);
      setBody(r.announcement.body);
      setWarnings(r.warnings ?? []);
      setDrafted(true);
    } catch { /* shown below */ }
  };
  const close = () => { setOpen(false); };

  return (
    <>
      <Button label={label} icon="auto-awesome" variant="secondary" disabled={disabled} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={close} title="Draft announcement">
        <View style={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
          <TextField label="Key points" value={points} onChangeText={setPoints} multiline maxLength={1500} placeholder="Dates, venue, who should attend, what to bring" helper="Only facts you list here (and the drive's details) are used." />
          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" color={colors.muted}>Tone</Text>
            <SegmentedControl value={tone} onChange={(v) => setTone(v as typeof tone)} options={TONES} />
          </View>
          {m.isError ? <AiErrorBanner error={m.error} onRetry={generate} /> : null}
          <Button label={drafted ? 'Regenerate draft' : 'Generate draft'} icon="auto-awesome" variant={drafted ? 'secondary' : 'primary'} full loading={m.isPending} disabled={!ok} onPress={generate} />

          {drafted ? (
            <View style={{ gap: spacing.lg }}>
              <Banner tone="warning" title="Draft: review before sending" message="Check every date and number. Nothing is sent until you post the announcement yourself." />
              {warnings.length ? <Banner tone="warning" title="Check these" message={warnings.join('\n')} /> : null}
              <TextField label="Title" value={title} onChangeText={setTitle} maxLength={120} />
              <TextField label="Message" value={body} onChangeText={setBody} multiline maxLength={1200} />
              <Button label="Use this draft" icon="check" full disabled={!title.trim() || !body.trim()} onPress={() => { onUse({ title: title.trim(), body: body.trim() }); close(); }} />
            </View>
          ) : null}
        </View>
      </Sheet>
    </>
  );
}
