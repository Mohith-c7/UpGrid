import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Badge, Banner, Button, Card, Header, Icon, MetricRow, OfflineBanner, Screen, SectionHeader, Sheet, Text, useIsOnline, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useImportStudents } from '@/api/hooks';
import type { StudentImportResult } from '@/api/types';
import { readTextFile, shareTextFile } from '@/lib/shareFile';
import { useBack } from '@/features/student/me/kit';
import { chunkRows, CHUNK_SIZE, parseStudentCsv, TEMPLATE_CSV, type ParsedImport } from '@/features/officer/csv';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

const MAX_BYTES = 2 * 1024 * 1024;
const COLUMN_LABEL: Record<string, string> = {
  registrationNumber: 'Registration no.', email: 'Email', department: 'Department', program: 'Program', batchYear: 'Batch year',
  semester: 'Semester', cgpa: 'CGPA', cgpaScale: 'CGPA scale', tenthPercent: '10th %', twelfthPercent: '12th %',
  activeBacklogs: 'Active backlogs', gapYears: 'Gap years',
};

function fieldsText(f: unknown): string {
  if (Array.isArray(f)) return f.join(', ');
  if (f && typeof f === 'object') return Object.entries(f as Record<string, string>).map(([k, v]) => `${COLUMN_LABEL[k] ?? k}: ${v}`).join('; ');
  return String(f ?? '');
}

interface Merged extends StudentImportResult { skippedClient: number; failedAfter?: { done: number; total: number; message: string } }

export default function ImportStudents() {
  const back = useBack('/(officer)/(tabs)/more');
  const toast = useToast();
  const online = useIsOnline();
  const importer = useImportStudents();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [result, setResult] = useState<Merged | null>(null);
  const busy = useRef(false);

  const reset = () => { setFileName(null); setParsed(null); setLoadError(null); setResult(null); setShowAllErrors(false); setProgress(null); };

  const pick = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoadError(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      const looksCsv = /\.csv$/i.test(a.name ?? '') || /csv|comma-separated|text\/plain/i.test(a.mimeType ?? '');
      if (!looksCsv) { setLoadError('That does not look like a CSV file. Choose a .csv file (in Excel: Save As, CSV).'); return; }
      if ((a.size ?? 0) > MAX_BYTES) { setLoadError('That file is larger than 2 MB. Split it into smaller files.'); return; }
      const text = await readTextFile(a.uri);
      const p = parseStudentCsv(text);
      setFileName(a.name ?? 'file.csv');
      setParsed(p);
      setResult(null);
      setShowAllErrors(false);
    } catch (e) {
      setLoadError(errMessage(e));
    } finally { busy.current = false; }
  };

  const downloadTemplate = async () => {
    try { await shareTextFile('student-import-template.csv', TEMPLATE_CSV, 'text/csv', 'Student import template'); }
    catch (e) { toast.show(errMessage(e), 'error'); }
  };

  const run = async () => {
    if (!parsed || busy.current) return;
    busy.current = true;
    setConfirm(false);
    const chunks = chunkRows(parsed.valid, CHUNK_SIZE);
    const merged: Merged = { total: 0, updated: 0, unchanged: 0, unmatched: [], invalid: [], skippedClient: parsed.errors.length };
    try {
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        setProgress({ i: i + 1, n: chunks.length });
        try {
          const r = await importer.mutateAsync(chunks[i].map((c) => c.data));
          merged.total += r.total ?? chunks[i].length;
          merged.updated += r.updated ?? 0;
          merged.unchanged += r.unchanged ?? 0;
          // server `row` is 1-based within the batch; map back to the file's data row number
          const rowOf = (n: number) => chunks[i][n - 1]?.row ?? offset + n;
          merged.unmatched.push(...(r.unmatched ?? []).map((u) => ({ ...u, row: rowOf(u.row) })));
          merged.invalid.push(...(r.invalid ?? []).map((u) => ({ ...u, row: rowOf(u.row) })));
        } catch (e) {
          merged.failedAfter = { done: i, total: chunks.length, message: errMessage(e) };
          break;
        }
        offset += chunks[i].length;
      }
    } finally {
      setProgress(null);
      setResult(merged);
      busy.current = false;
    }
  };

  const errorsShown = parsed ? (showAllErrors ? parsed.errors : parsed.errors.slice(0, 10)) : [];
  const sample = parsed?.valid.slice(0, 3) ?? [];
  const importing = progress !== null;

  const canImport = !!parsed && !parsed.fileError && parsed.valid.length > 0;
  const footer = !result && parsed && !parsed.fileError ? (
    <>
      {importing ? <Text variant="caption" tabular color={colors.muted} accessibilityLiveRegion="polite" align="center">Sending batch {progress!.i} of {progress!.n}…</Text> : null}
      {!online ? <Text variant="caption" color={colors.warning} align="center">You are offline. Reconnect to import.</Text> : null}
      <Button label={`Import ${parsed.valid.length} ${parsed.valid.length === 1 ? 'row' : 'rows'}`} icon="upload" full disabled={!canImport || !online || importing} loading={importing} onPress={() => setConfirm(true)} />
    </>
  ) : undefined;

  return (
    <Screen scroll padded={false} edges={['bottom']} keyboard footer={footer}>
      <FocusedStatusBar />
      <Header variant="bar" title="Import academic data" onBack={back} />
      <View style={{ padding: 16, gap: 16 }}>
        <OfflineBanner />
        {result ? (
          <>
            <Banner tone={result.failedAfter ? 'error' : result.invalid.length || result.unmatched.length || result.skippedClient ? 'warning' : 'success'}
              title={result.failedAfter ? 'Import stopped' : 'Import finished'}
              message={result.failedAfter ? `${result.failedAfter.message}. ${result.failedAfter.done} of ${result.failedAfter.total} batches were saved before the problem. Importing the same file again is safe: rows already saved show as unchanged.` : `${result.updated} students updated.`} />
            <Card padding={0} style={{ paddingHorizontal: 16 }}>
              <MetricRow label="Rows processed" value={result.total} />
              <MetricRow label="Updated" value={result.updated} tone={result.updated ? 'success' : undefined} />
              <MetricRow label="Unchanged" value={result.unchanged} />
              <MetricRow label="Not found" value={result.unmatched.length} tone={result.unmatched.length ? 'warning' : undefined} />
              <MetricRow label="Rejected by the server" value={result.invalid.length} tone={result.invalid.length ? 'error' : undefined} last={result.skippedClient === 0} />
              {result.skippedClient > 0 ? <MetricRow label="Skipped before upload" hint="Fix and re-import" value={result.skippedClient} tone="error" last /> : null}
            </Card>
            {result.unmatched.length > 0 ? (
              <>
                <SectionHeader title={`Not found (${result.unmatched.length})`} subtitle="No student has registered with these numbers yet." />
                <Card padding={0} style={{ paddingHorizontal: 16 }}>
                  {result.unmatched.slice(0, 100).map((u, i) => <IssueRow key={`${u.row}-${i}`} tone="warning" title={`Row ${u.row}: ${u.registrationNumber}`} lines={[u.reason]} />)}
                </Card>
                {result.unmatched.length > 100 ? <Text variant="caption" color={colors.muted}>Showing the first 100.</Text> : null}
              </>
            ) : null}
            {result.invalid.length > 0 ? (
              <>
                <SectionHeader title={`Rejected (${result.invalid.length})`} />
                <Card padding={0} style={{ paddingHorizontal: 16 }}>
                  {result.invalid.slice(0, 100).map((u, i) => <IssueRow key={`${u.row}-${i}`} tone="error" title={`Row ${u.row}: ${u.registrationNumber}`} lines={[fieldsText(u.fields)]} />)}
                </Card>
                {result.invalid.length > 100 ? <Text variant="caption" color={colors.muted}>Showing the first 100.</Text> : null}
              </>
            ) : null}
            <Button label="Import another file" variant="secondary" full onPress={reset} />
          </>
        ) : (
          <>
            <Card style={{ gap: 12 }}>
              <Text variant="heading">How it works</Text>
              <View style={{ gap: 8 }}>
                {[
                  'Upload a CSV with one row per student.',
                  'Students are matched by registration number.',
                  'Only the columns you include are updated. Empty cells are left unchanged.',
                ].map((t, i) => (
                  <View key={t} style={{ flexDirection: 'row', gap: 10 }}>
                    <Text variant="body" tabular color={colors.primary} style={{ fontWeight: '700', width: 18 }}>{i + 1}</Text>
                    <Text variant="body" style={{ flex: 1 }}>{t}</Text>
                  </View>
                ))}
              </View>
              <Text variant="caption" color={colors.muted}>Columns: registrationNumber (required), email, department, program, batchYear, semester, cgpa, cgpaScale, tenthPercent, twelfthPercent, activeBacklogs, gapYears. Common names such as "Reg No", "CGPA" and "10th %" also work. Rows are counted below the header row.</Text>
              <Button label="Download template" icon="download" variant="secondary" full onPress={downloadTemplate} />
            </Card>
            <Button label={parsed ? 'Choose a different file' : 'Choose CSV file'} icon="upload-file" variant={parsed && !parsed.fileError ? 'secondary' : 'primary'} full disabled={importing} onPress={pick} />
            {loadError ? <Banner tone="error" message={loadError} /> : null}

            {parsed?.fileError ? (
              <Banner tone="error" title="Cannot read this file" message={parsed.fileError} />
            ) : parsed ? (
              <>
                <SectionHeader title="Preview" />
                <Card style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Icon name="description" size={22} color={colors.primary} />
                    <Text variant="subhead" numberOfLines={2} style={{ flex: 1 }}>{fileName}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Badge label={`${parsed.totalRows} rows`} icon="format-list-numbered" />
                    <Badge label={`${parsed.valid.length} ready`} tone="success" />
                    {parsed.errors.length > 0 ? <Badge label={`${parsed.errors.length} with errors`} tone="error" /> : null}
                  </View>
                  <Text variant="caption" color={colors.muted}>Columns used: {parsed.columns.map((c) => COLUMN_LABEL[c] ?? c).join(', ')}</Text>
                  {parsed.ignoredHeaders.length > 0 ? <Text variant="caption" color={colors.warning}>Ignored columns: {parsed.ignoredHeaders.join(', ')}</Text> : null}
                </Card>
                {sample.length > 0 ? (
                  <Card style={{ gap: 10 }}>
                    <Text variant="subhead">First rows</Text>
                    {sample.map((s) => (
                      <View key={s.row} style={{ gap: 2 }}>
                        <Text variant="body" tabular style={{ fontWeight: '600' }}>Row {s.row}: {s.data.registrationNumber}</Text>
                        <Text variant="caption" color={colors.muted} tabular>
                          {Object.entries(s.data).filter(([k]) => k !== 'registrationNumber').map(([k, v]) => `${COLUMN_LABEL[k] ?? k} ${v}`).join(' · ') || 'No other columns'}
                        </Text>
                      </View>
                    ))}
                  </Card>
                ) : null}
                {parsed.errors.length > 0 ? (
                  <>
                    <SectionHeader title={`Fix these rows (${parsed.errors.length})`} subtitle="Rows with errors are skipped. Fix them in your file and import again." />
                    <Card padding={0} style={{ paddingHorizontal: 16 }}>
                      {errorsShown.map((e) => <IssueRow key={e.row} tone="error" title={`Row ${e.row}${e.registrationNumber ? `: ${e.registrationNumber}` : ''}`} lines={e.messages} />)}
                    </Card>
                    {parsed.errors.length > 10 ? <Button label={showAllErrors ? 'Show fewer' : `Show all ${parsed.errors.length}`} variant="ghost" onPress={() => setShowAllErrors((v) => !v)} /> : null}
                  </>
                ) : null}
                {parsed.valid.length === 0 ? <Banner tone="warning" message="No valid rows to import. Fix the errors above and choose the file again." /> : null}
              </>
            ) : null}
          </>
        )}
      </View>

      <Sheet visible={confirm} onClose={() => setConfirm(false)} title="Import these rows?">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Text variant="body" tabular>
            {parsed?.valid.length ?? 0} rows will update matching students{parsed && parsed.errors.length ? `; ${parsed.errors.length} rows with errors will be skipped` : ''}. {parsed && parsed.valid.length > CHUNK_SIZE ? `They are sent in ${Math.ceil(parsed.valid.length / CHUNK_SIZE)} batches. ` : ''}
          </Text>
          <Text variant="caption" color={colors.muted}>Imported values replace what students entered for those fields. Keep your original file in case you need to check it.</Text>
          <Button label="Import" full onPress={run} />
          <Button label="Cancel" variant="secondary" full onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function IssueRow({ tone, title, lines }: { tone: 'error' | 'warning'; title: string; lines: string[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Icon name={tone === 'error' ? 'error-outline' : 'warning-amber'} size={20} color={tone === 'error' ? colors.error : colors.warning} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" tabular style={{ fontWeight: '600' }}>{title}</Text>
        {lines.map((l, i) => <Text key={i} variant="caption" color={tone === 'error' ? colors.error : colors.muted}>{l}</Text>)}
      </View>
    </View>
  );
}
