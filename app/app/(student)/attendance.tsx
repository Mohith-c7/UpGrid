import React, { useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Banner, Button, Card, Icon, SegmentedControl, Skeleton, Text, TextField, useIsOnline } from '@/ui';
import { colors, radius } from '@/theme';
import { pipeError, useScanAttendance } from '@/api/pipeline';
import type { ScanResult } from '@/api/pipelineTypes';
import { formatIST, Page, sp, useOnce } from '@/features/pipeline/kit';

/** Accepts the raw token or the "POSATT1." payload; the server accepts both, we only trim and strip spaces. */
const clean = (s: string) => s.replace(/\s+/g, '');

export default function AttendanceScreen() {
  const { applicationId } = useLocalSearchParams<{ applicationId?: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const online = useIsOnline();
  const [perm, requestPerm] = useCameraPermissions();
  const scan = useScanAttendance();
  const [mode, setMode] = useState<'scan' | 'code'>('scan');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const inFlight = useRef(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/applications' as never));

  const submit = async (raw: string) => {
    const token = clean(raw);
    if (!token || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPaused(true);
    try {
      setResult(await scan.mutateAsync(token));
    } catch (e) {
      setError(pipeError(e));
    } finally { inFlight.current = false; }
  };
  const [doManual, submitting] = useOnce(async () => {
    if (!clean(code)) { setError('Enter the code shown by the organiser.'); return; }
    if (!online) { setError('You are offline. Reconnect to mark attendance.'); return; }
    await submit(code);
  });
  const again = () => { setError(null); setResult(null); setPaused(false); setCode(''); };

  const denied = perm && !perm.granted;
  const camReady = perm?.granted && mode === 'scan' && focused;

  let body: React.ReactNode;
  if (result) {
    body = (
      <Card tinted>
        <View style={{ gap: sp.md, alignItems: 'flex-start' }}>
          <Icon name="check-circle" size={32} color={colors.success} />
          <Text variant="title">{result.replayed ? 'Already marked' : 'Attendance marked'}</Text>
          <Text variant="body" color={colors.textSecondary}>{`${result.round.name}. Recorded ${formatIST(result.markedAt)} by the server clock.`}</Text>
          {result.replayed ? <Text variant="caption" color={colors.muted}>You had already scanned this session, so nothing changed.</Text> : null}
          <Button label={applicationId ? 'Back to application' : 'Done'} full onPress={() => (applicationId ? router.replace(`/(student)/application/${applicationId}` as never) : back())} />
        </View>
      </Card>
    );
  } else {
    body = (
      <>
        {!online ? <Banner tone="warning" message="You are offline. Attendance can only be marked while connected." /> : null}
        <SegmentedControl value={mode} onChange={(v) => { setMode(v as 'scan' | 'code'); setError(null); setPaused(false); }} options={[{ value: 'scan', label: 'Scan QR' }, { value: 'code', label: 'Enter code' }]} />

        {mode === 'scan' ? (
          !perm ? <Skeleton height={280} radius={14} /> : perm.granted ? (
            <View style={{ gap: sp.sm }}>
              <View style={{ height: 300, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.ink }}>
                {camReady ? (
                  <CameraView
                    style={{ flex: 1 }}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={paused || submitting ? undefined : ({ data }) => { void submit(String(data)); }}
                    accessibilityLabel="Camera viewfinder for the attendance QR"
                  />
                ) : null}
              </View>
              <Text variant="caption" color={colors.muted}>Point the camera at the QR shown by the organiser. It is read automatically.</Text>
            </View>
          ) : (
            <Card>
              <View style={{ gap: sp.md }}>
                <Icon name="no-photography" size={28} color={colors.muted} />
                <Text variant="subhead">Camera access is off</Text>
                <Text variant="body" color={colors.textSecondary}>
                  {perm.canAskAgain ? 'Allow the camera to scan the attendance QR. The picture is never saved or uploaded.' : 'Camera permission was denied. You can turn it on in system settings, or enter the code by hand.'}
                </Text>
                {perm.canAskAgain ? <Button label="Allow camera" icon="photo-camera" full onPress={async () => { await requestPerm(); }} />
                  : <Button label="Open settings" icon="settings" full onPress={() => { Linking.openSettings().catch(() => undefined); }} />}
                <Button label="Enter code instead" variant="secondary" full onPress={() => setMode('code')} />
              </View>
            </Card>
          )
        ) : (
          <Card>
            <View style={{ gap: sp.md }}>
              <TextField label="Attendance code" value={code} onChangeText={(t) => { setCode(t); setError(null); }} autoCapitalize="none"
                helper="Type or paste the code shown below the QR (it may start with POSATT1.)" returnKeyType="done" onSubmitEditing={() => { void doManual(); }} />
              <Button label="Mark attendance" full loading={submitting || scan.isPending} disabled={!online} onPress={() => doManual()} />
            </View>
          </Card>
        )}

        {error ? (
          <Banner tone="error" title="Attendance not marked" message={error} action={{ label: 'Try again', onPress: again }} />
        ) : null}
        {denied && mode === 'code' ? <Banner tone="info" message="Camera is off, so manual entry is shown. You can enable the camera in settings to scan." /> : null}
      </>
    );
  }

  return (
    <Page title="Mark attendance" onBack={back} keyboard>
      {body}
    </Page>
  );
}
