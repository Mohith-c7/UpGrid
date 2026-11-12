/** Parts of the test runner screen: save indicator, question palette, submit summary. */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Banner, Button, Icon, MetricRow, Sheet, Text, type IconName } from '@/ui';
import { colors, MIN_TOUCH, radius, toneColors } from '@/theme';
import type { StudentQuestion } from '@/api/testsTypes';
import type { SaveStatus, useAttemptSession } from './useAttemptSession';
import { plural, sp } from './kit';

type Session = ReturnType<typeof useAttemptSession>;

/* ---------------------------------------------------------------- save indicator */
export function SaveIndicator({ status, pending, note }: { status: SaveStatus; pending: number; note?: string | null }) {
  const m: Record<SaveStatus, { icon: IconName; text: string; color: string }> = {
    saved: { icon: 'cloud-done', text: 'All answers saved', color: colors.success },
    saving: { icon: 'sync', text: 'Saving...', color: colors.muted },
    unsaved: { icon: 'edit', text: 'Saving soon', color: colors.muted },
    offline: { icon: 'cloud-off', text: `Offline: ${plural(pending, 'answer')} waiting, will save when connected`, color: colors.warning },
    error: { icon: 'error-outline', text: 'Could not save yet, retrying', color: colors.error },
  };
  const x = m[status];
  return (
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`${x.text}${note ? `. ${note}` : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
      <Icon name={x.icon} size={20} color={x.color} />
      <Text variant="caption" color={x.color} style={{ flex: 1, minWidth: 0, fontWeight: '600' }}>{x.text}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- palette */
const CELL = 52;
function Cell({ q, status, current, onPress, disabled }: { q: StudentQuestion; status: 'answered' | 'flagged' | 'visited' | 'unvisited'; current: boolean; onPress: () => void; disabled?: boolean }) {
  const tone = status === 'answered' ? toneColors.success : status === 'flagged' ? toneColors.warning : null;
  const icon: IconName | null = disabled ? 'lock' : status === 'answered' ? 'check' : status === 'flagged' ? 'flag' : status === 'visited' ? 'remove' : null;
  const label = disabled ? 'locked' : status === 'visited' ? 'seen, not answered' : status === 'unvisited' ? 'not visited' : status;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Question ${q.number}, ${label}${current ? ', current' : ''}`}
      style={{
        width: CELL, height: CELL, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center',
        borderWidth: current ? 3 : 1, borderColor: current ? colors.primaryDark : tone ? tone.border : colors.borderStrong,
        backgroundColor: disabled ? colors.pressed : tone ? tone.bg : colors.surface,
      }}
    >
      <Text variant="subhead" tabular color={tone ? tone.fg : colors.ink}>{q.number}</Text>
      {icon ? <Icon name={icon} size={14} color={tone ? tone.fg : colors.muted} /> : <View style={{ height: 14 }} />}
    </Pressable>
  );
}

function LegendItem({ icon, label, tone }: { icon: IconName | null; label: string; tone?: 'success' | 'warning' }) {
  const t = tone ? toneColors[tone] : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 140 }}>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: t ? t.border : colors.borderStrong, backgroundColor: t ? t.bg : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        {icon ? <Icon name={icon} size={14} color={t ? t.fg : colors.muted} /> : null}
      </View>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

export function PaletteSheet({ visible, onClose, s, onPick }: { visible: boolean; onClose: () => void; s: Session; onPick: (id: string) => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Questions">
      <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: sp.lg, paddingBottom: sp.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: sp.md, rowGap: sp.sm }}>
          <LegendItem icon="check" label="Answered" tone="success" />
          <LegendItem icon="flag" label="Marked for review" tone="warning" />
          <LegendItem icon="remove" label="Seen, not answered" />
          <LegendItem icon={null} label="Not visited" />
        </View>
        {s.sections.map((sec) => {
          const qs = s.questions.filter((q) => q.sectionId === sec.id);
          const locked = s.isSequential && sec.locked;
          return (
            <View key={sec.id} style={{ gap: sp.sm }}>
              <Text variant="subhead">
                {sec.title}
                {locked ? '  (locked)' : !sec.enteredAt && s.isSequential ? '  (not opened yet)' : ''}
              </Text>
              {qs.length === 0 ? (
                <Text variant="caption" color={colors.muted}>
                  {sec.questionIds.length ? `${plural(sec.questionIds.length, 'question')} appear when you open this section.` : 'No questions.'}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {qs.map((q) => (
                    <Cell key={q.id} q={q} status={s.statusOf(q)} current={s.curQuestion?.id === q.id} disabled={locked} onPress={() => { onPick(q.id); onClose(); }} />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- submit summary */
export function SubmitSheet({ visible, onClose, s, onConfirm }: { visible: boolean; onClose: () => void; s: Session; onConfirm: () => void }) {
  const { summary } = s;
  const offlineWithPending = !s.online;
  return (
    <Sheet visible={visible} onClose={s.submitting ? () => undefined : onClose} title="Submit test">
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: sp.md, paddingBottom: sp.md }}>
        <View>
          <MetricRow label="Answered" value={`${summary.answered} of ${summary.total}`} tone="success" />
          <MetricRow label="Not answered" value={summary.unanswered} tone={summary.unanswered ? 'warning' : undefined} />
          <MetricRow label="Marked for review" value={summary.flagged} />
          <MetricRow label="Not visited" value={summary.unvisited} last />
        </View>
        {s.sections.length > 1 ? (
          <View style={{ gap: 2 }}>
            <Text variant="subhead">By section</Text>
            {summary.rows.map((r, i) => (
              <MetricRow
                key={r.section.id}
                label={r.section.title}
                value={r.notOpened ? 'Not opened' : `${r.answered} of ${r.total}`}
                hint={r.notOpened ? 'You have not opened this section' : r.flagged ? `${r.flagged} marked for review` : undefined}
                last={i === summary.rows.length - 1}
              />
            ))}
          </View>
        ) : null}
        {summary.unsubmittedCoding.length > 0 ? (
          <Banner
            tone="info"
            title="Code not submitted for evaluation"
            message={`Question ${summary.unsubmittedCoding.map((q) => q.number).join(', ')}: your latest code has not been submitted with "Submit code". It is evaluated automatically when you submit the test.`}
          />
        ) : null}
        {summary.flagged > 0 ? <Banner tone="warning" message={`${plural(summary.flagged, 'question')} still marked for review.`} icon="flag" /> : null}
        {s.pendingCount > 0 ? <Banner tone="info" message={`${plural(s.pendingCount, 'recent answer')} will be sent together with your submission.`} icon="cloud-upload" /> : null}
        {offlineWithPending ? <Banner tone="warning" title="You are offline" message="Reconnect to submit. Your answers are safe on this device and the timer keeps running." icon="cloud-off" /> : null}
        {s.submitError ? <Banner tone="error" title="Not submitted" message={s.submitError} /> : null}
        <Text variant="caption" color={colors.muted}>You cannot change answers after submitting.</Text>
        <Button label={s.submitError ? 'Try again' : 'Submit test'} icon="send" full loading={s.submitting} disabled={offlineWithPending} onPress={onConfirm} />
        <Button label="Keep working" variant="secondary" full disabled={s.submitting} onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- footer nav */
export function NavButton({ icon, label, onPress, disabled, active, a11y }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; active?: boolean; a11y?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => ({
        flex: 1, minHeight: 56, minWidth: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.button,
        backgroundColor: pressed ? colors.pressed : active ? toneColors.warning.bg : 'transparent', opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={icon} size={24} color={active ? toneColors.warning.fg : colors.ink} />
      <Text variant="caption" numberOfLines={2} align="center" maxFontSizeMultiplier={1.3} color={active ? toneColors.warning.fg : colors.ink} style={{ fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
