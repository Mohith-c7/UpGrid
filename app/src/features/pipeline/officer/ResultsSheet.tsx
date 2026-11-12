import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Sheet, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { pipeError, useRoundCandidateActions } from '@/api/pipeline';
import type { ResultRow, ResultsUploadResult } from '@/api/pipelineTypes';
import { sp, useOnce } from '../kit';

const RESULT_MAP: Record<string, ResultRow['result']> = {
  passed: 'passed', pass: 'passed', failed: 'failed', fail: 'failed', absent: 'absent', on_hold: 'on_hold', hold: 'on_hold', onhold: 'on_hold',
};

export function parseResults(text: string): { rows: ResultRow[]; errors: string[] } {
  const rows: ResultRow[] = []; const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[,\t]/).map((s) => s.trim());
    if (idx === 0 && /^(reference|ref|application)/i.test(parts[0] ?? '')) return;
    const [reference, resultRaw, scoreRaw, ...rest] = parts;
    const n = idx + 1;
    if (!reference) { errors.push(`Line ${n}: missing reference`); return; }
    const result = RESULT_MAP[(resultRaw ?? '').toLowerCase().replace(/[\s-]+/g, '_')];
    if (!result) { errors.push(`Line ${n}: result must be passed, failed, absent or on_hold`); return; }
    let score: number | undefined;
    if (scoreRaw) {
      score = Number(scoreRaw);
      if (!Number.isFinite(score) || score < 0 || score > 100) { errors.push(`Line ${n}: score must be 0 to 100`); return; }
    }
    const remark = rest.join(', ').trim();
    if (remark.length > 300) { errors.push(`Line ${n}: remark is over 300 characters`); return; }
    rows.push({ reference, result, ...(score !== undefined ? { score } : {}), ...(remark ? { remark } : {}) });
  });
  if (rows.length > 500) errors.push('At most 500 rows per upload. Split the list.');
  return { rows, errors };
}

/** Paste results as lines: reference, result, score (optional), remark (optional). Students see them only after Publish results. */
export function ResultsSheet({ driveId, roundId, visible, onClose }: { driveId: string; roundId: string; visible: boolean; onClose: () => void }) {
  const { uploadResults } = useRoundCandidateActions(driveId, roundId);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultsUploadResult | null>(null);
  useEffect(() => { if (visible) { setText(''); setErrors([]); setApiError(null); setResult(null); } }, [visible]);

  const [send, busy] = useOnce(async () => {
    const p = parseResults(text);
    setErrors(p.errors); setApiError(null);
    if (p.rows.length === 0) { if (!p.errors.length) setErrors(['Paste at least one line.']); return; }
    if (p.errors.length) return;
    try { setResult(await uploadResults.mutateAsync(p.rows)); } catch (e) { setApiError(pipeError(e)); }
  });

  return (
    <Sheet visible={visible} onClose={() => { if (!busy) onClose(); }} title="Upload results">
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        {result ? (
          <>
            <Banner tone={result.failed.length ? 'warning' : 'success'} title="Upload finished"
              message={`${result.updated} updated, ${result.unchanged} unchanged, ${result.failed.length} failed of ${result.total}. Students see results after you publish them.`} />
            {result.failed.slice(0, 15).map((f) => (
              <Text key={`${f.row}-${f.reference}`} variant="caption" color={colors.textSecondary}>{`Row ${f.row}${f.reference ? ` (${f.reference})` : ''}: ${f.reason}`}</Text>
            ))}
            {result.failed.length > 15 ? <Text variant="caption" color={colors.muted}>{`and ${result.failed.length - 15} more`}</Text> : null}
            <Button label="Done" full onPress={onClose} />
          </>
        ) : (
          <>
            <Text variant="body" color={colors.textSecondary}>One candidate per line: application reference, result, score (optional), remark (optional). Results can be passed, failed, absent or on_hold. Use commas or tabs, so you can paste straight from a spreadsheet.</Text>
            <TextField label="Results" value={text} onChangeText={(t) => { setText(t); setErrors([]); }} multiline autoCapitalize="none" placeholder={'PLC-1042, passed, 82, Strong on arrays\nPLC-1043, failed, 41'} />
            {errors.length ? <Banner tone="error" title="Fix these lines" message={errors.slice(0, 6).join('\n') + (errors.length > 6 ? `\nand ${errors.length - 6} more` : '')} /> : null}
            {apiError ? <Banner tone="error" message={apiError} /> : null}
            <Button label="Upload results" icon="upload" full loading={busy} onPress={() => send()} />
          </>
        )}
      </View>
    </Sheet>
  );
}
