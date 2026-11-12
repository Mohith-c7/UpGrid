import React, { useState } from 'react';
import { View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Banner, Button, MetricRow, Sheet, Text, useIsOnline, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useImportQuestions, type ImportErrorRow, type ImportPayload } from '@/api/assessments';
import { readTextFile, shareTextFile } from '@/lib/shareFile';
import { parseCsv, toCsv } from '@/features/officer/csv';
import { prettyPath } from './kit';

const MAX_ROWS = 200;
const MAX_CHARS = 80_000; // server body limit is 100 KB
const MAX_FILE = 2 * 1024 * 1024;

const TEMPLATE = toCsv([
  ['type', 'title', 'body', 'optionA', 'optionB', 'optionC', 'optionD', 'correct', 'topic', 'tags', 'difficulty', 'marks', 'negativeMarks', 'explanation'],
  ['mcq_single', 'Which data structure uses FIFO order?', 'Which data structure uses FIFO order?', 'Stack', 'Queue', 'Tree', 'Graph', 'B', 'Data structures', 'dsa;basics', 'easy', '1', '0.25', 'A queue removes the oldest item first.'],
  ['mcq_multi', 'Select all prime numbers', 'Select all prime numbers', '2', '4', '7', '9', 'A;C', 'Aptitude', 'numbers', 'medium', '2', '0', ''],
]);

interface Chunk { payload: ImportPayload; offset: number }

function splitRows<T>(rows: T[], size: (r: T) => number): { rows: T[]; offset: number }[] {
  const out: { rows: T[]; offset: number }[] = [];
  let cur: T[] = []; let chars = 0; let start = 0;
  rows.forEach((r, i) => {
    const s = size(r);
    if (cur.length >= MAX_ROWS || (cur.length > 0 && chars + s > MAX_CHARS)) { out.push({ rows: cur, offset: start }); cur = []; chars = 0; start = i; }
    cur.push(r); chars += s;
  });
  if (cur.length) out.push({ rows: cur, offset: start });
  return out;
}

function buildChunks(name: string, text: string): { chunks: Chunk[]; total: number } {
  const isJson = /\.json$/i.test(name) || /^\s*[\[{]/.test(text);
  if (isJson) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
    const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.rows) ? (data as any).rows : Array.isArray((data as any)?.questions) ? (data as any).questions : null;
    if (!rows) throw new Error('Expected a JSON array of question objects (or an object with a "rows" array).');
    if (rows.length === 0) throw new Error('The file has no rows.');
    return { total: rows.length, chunks: splitRows<unknown>(rows, (r) => JSON.stringify(r).length + 1).map((c) => ({ offset: c.offset, payload: { format: 'json', rows: c.rows } })) };
  }
  const all = parseCsv(text);
  if (all.length < 2) throw new Error('The CSV needs a header row and at least one question.');
  const [header, ...data] = all;
  return {
    total: data.length,
    chunks: splitRows<string[]>(data, (r) => r.reduce((n, c) => n + c.length + 3, 0)).map((c) => ({ offset: c.offset, payload: { format: 'csv', csv: toCsv([header, ...c.rows]) } })),
  };
}

type Stage = 'idle' | 'checking' | 'preview' | 'importing' | 'done';

export function ImportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const online = useIsOnline();
  const imp = useImportQuestions();
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState('');
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [total, setTotal] = useState(0);
  const [valid, setValid] = useState(0);
  const [imported, setImported] = useState(0);
  const [errors, setErrors] = useState<ImportErrorRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => { setStage('idle'); setFile(''); setChunks([]); setTotal(0); setValid(0); setImported(0); setErrors([]); setShowAll(false); setProblem(null); };
  const close = () => { if (stage === 'checking' || stage === 'importing') return; reset(); onClose(); };

  const pick = async () => {
    setProblem(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      if (!/\.(csv|json)$/i.test(a.name ?? '') && !/csv|json|text\/plain/i.test(a.mimeType ?? '')) { setProblem('Choose a .csv or .json file.'); return; }
      if ((a.size ?? 0) > MAX_FILE) { setProblem('That file is larger than 2 MB. Split it into smaller files.'); return; }
      const text = await readTextFile(a.uri);
      const built = buildChunks(a.name ?? 'file.csv', text);
      setFile(a.name ?? 'file'); setChunks(built.chunks); setTotal(built.total);
      await runCheck(built.chunks, built.total);
    } catch (e) { setProblem(errMessage(e)); setStage('idle'); }
  };

  const runCheck = async (cs: Chunk[], tot: number) => {
    setStage('checking'); setProblem(null);
    let v = 0; const errs: ImportErrorRow[] = [];
    try {
      for (const c of cs) {
        const res = await imp.mutateAsync({ payload: c.payload, dryRun: true });
        v += res.valid;
        res.errors.forEach((e) => errs.push({ row: e.row + c.offset, fields: e.fields }));
      }
      setValid(v); setErrors(errs); setTotal(tot); setStage('preview');
    } catch (e) { setProblem(errMessage(e)); setStage('idle'); }
  };

  const confirm = async () => {
    setStage('importing'); setProblem(null);
    let n = 0;
    try {
      for (const c of chunks) {
        const res = await imp.mutateAsync({ payload: c.payload, dryRun: false });
        n += res.imported;
      }
      setImported(n); setStage('done');
      toast.show(`${n} question${n === 1 ? '' : 's'} imported`, 'success');
    } catch (e) {
      setImported(n); setProblem(`${errMessage(e)}${n ? ` ${n} question(s) were imported before the failure; a repeat import would add duplicates, so check the bank first.` : ''}`);
      setStage(n ? 'done' : 'preview');
    }
  };

  const shown = showAll ? errors : errors.slice(0, 8);
  return (
    <Sheet visible={visible} onClose={close} title="Import questions">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        {!online ? <Banner tone="warning" message="You are offline. Connect to import." /> : null}
        {problem ? <Banner tone="error" message={problem} /> : null}

        {stage === 'idle' ? (
          <>
            <Text variant="body">Import multiple-choice questions from a CSV or JSON file. You will see a preview with any row errors before anything is saved.</Text>
            <Text variant="caption" color={colors.muted}>
              Columns: type (mcq_single or mcq_multi), title, body, optionA to optionH, correct (B or A;C), topic, tags (separated by ;), difficulty, marks, negativeMarks, explanation. Up to 200 rows per request; bigger files are sent in parts.
            </Text>
            <Button label="Choose CSV or JSON file" icon="upload-file" full disabled={!online} onPress={pick} />
            <Button label="Share a CSV template" icon="file-download" variant="secondary" full
              onPress={async () => { try { await shareTextFile('question-import-template.csv', TEMPLATE, 'text/csv', 'Question import template'); } catch (e) { toast.show(errMessage(e), 'error'); } }} />
          </>
        ) : null}

        {stage === 'checking' || stage === 'importing' ? (
          <Banner tone="info" message={stage === 'checking' ? `Checking ${file}...` : 'Importing. Keep this screen open.'} />
        ) : null}

        {stage === 'preview' ? (
          <>
            <Text variant="caption" color={colors.muted} numberOfLines={2}>{file}</Text>
            <View>
              <MetricRow label="Rows in file" value={total} />
              <MetricRow label="Valid" value={valid} tone={valid > 0 ? 'success' : undefined} />
              <MetricRow label="With errors (will be skipped)" value={errors.length} tone={errors.length ? 'error' : undefined} last />
            </View>
            {errors.length ? (
              <View style={{ gap: 8 }}>
                <Text variant="subhead">Row errors</Text>
                {shown.map((e, i) => (
                  <View key={`${e.row}-${i}`} style={{ borderLeftWidth: 3, borderLeftColor: colors.error, paddingLeft: 10, gap: 2 }}>
                    <Text variant="caption" style={{ fontWeight: '600' }} tabular>Row {e.row}</Text>
                    {Object.entries(e.fields).map(([k, v]) => <Text key={k} variant="caption" color={colors.muted}>{prettyPath(k)}: {v}</Text>)}
                  </View>
                ))}
                {errors.length > 8 ? <Button label={showAll ? 'Show fewer' : `Show all ${errors.length}`} variant="ghost" size="sm" onPress={() => setShowAll((s) => !s)} /> : null}
              </View>
            ) : null}
            {valid === 0 ? <Banner tone="error" message="No valid rows to import. Fix the file and choose it again." /> : null}
            <Button label={valid ? `Import ${valid} valid ${valid === 1 ? 'question' : 'questions'}` : 'Nothing to import'} full disabled={valid === 0 || !online} onPress={confirm} />
            <Button label="Choose another file" variant="secondary" full onPress={reset} />
          </>
        ) : null}

        {stage === 'done' ? (
          <>
            <Banner tone="success" title="Import finished" message={`${imported} question${imported === 1 ? '' : 's'} added to the bank.`} />
            <Button label="Done" full onPress={close} />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}
