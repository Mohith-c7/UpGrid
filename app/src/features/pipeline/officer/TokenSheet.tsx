import React, { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Banner, Button, CodeBlock, Select, Sheet, Text, TextField } from '@/ui';
import { colors, radius } from '@/theme';
import { pipeError, useRoundCandidateActions } from '@/api/pipeline';
import type { AttendanceToken } from '@/api/pipelineTypes';
import { confirm, formatIST, sp, useOnce } from '../kit';

const DURATIONS = [{ value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '120', label: '2 hours' }, { value: '240', label: '4 hours' }, { value: '720', label: '12 hours' }];

/** Create an attendance token, show it as a QR (and as text), revoke it. The server shows the token once. */
export function TokenSheet({ driveId, roundId, roundName, visible, onClose }: { driveId: string; roundId: string; roundName: string; visible: boolean; onClose: () => void }) {
  const { createToken, revokeToken } = useRoundCandidateActions(driveId, roundId);
  const [session, setSession] = useState('default');
  const [minutes, setMinutes] = useState('60');
  const [token, setToken] = useState<AttendanceToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => { if (visible) { setError(null); setInfo(null); } }, [visible]);

  const [create, creating] = useOnce(async () => {
    const s = session.trim() || 'default';
    if (s.length > 40) { setError('Session name can be at most 40 characters.'); return; }
    setError(null); setInfo(null);
    try { setToken(await createToken.mutateAsync({ session: s, validMinutes: Number(minutes) })); }
    catch (e) { setError(pipeError(e)); }
  });
  const [revoke, revoking] = useOnce(async () => {
    setError(null);
    try {
      await revokeToken.mutateAsync((token?.session ?? session.trim()) || 'default');
      setToken(null); setInfo('Code revoked. Students can no longer scan it.');
    } catch (e) { setError(pipeError(e)); }
  });

  return (
    <Sheet visible={visible} onClose={() => { if (!creating && !revoking) onClose(); }} title="Attendance QR">
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        <Text variant="body" color={colors.textSecondary}>{`Show this at the venue for ${roundName}. Students scan it in the app. Only invited, non-waitlisted candidates can be marked present, and the server clock decides the time.`}</Text>
        {token ? (
          <>
            <View accessible accessibilityLabel={`QR code for attendance session ${token.session}. Code text below.`}
              style={{ alignSelf: 'center', backgroundColor: colors.surface, padding: 16, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border }}>
              <QRCode value={token.qrPayload} size={220} backgroundColor={colors.surface} color={colors.ink} />
            </View>
            <Text variant="caption" color={colors.muted} align="center" tabular>{`Valid ${formatIST(token.validFrom)} to ${formatIST(token.validUntil)}`}</Text>
            <CodeBlock label="Code (for manual entry)" code={token.qrPayload} />
            <Banner tone="warning" message="This code is shown only now. If you close this screen you must create a new one, which cancels this one." />
            <Button label="Share code" variant="secondary" icon="share" full onPress={async () => { try { await Share.share({ message: `Attendance code for ${roundName}: ${token.qrPayload}` }); } catch { /* user dismissed */ } }} />
            <Button label="Revoke code" variant="danger" icon="block" full loading={revoking}
              onPress={() => confirm('Revoke this code?', 'Students will no longer be able to mark attendance with it.', 'Revoke', () => { void revoke(); })} />
          </>
        ) : (
          <>
            <TextField label="Session name" value={session} onChangeText={setSession} maxLength={40} helper="Use different names for morning and afternoon batches. A new code for the same name replaces the old one." autoCapitalize="none" />
            <Select label="Valid for" value={minutes} onChange={setMinutes} options={DURATIONS} />
            {info ? <Banner tone="success" message={info} /> : null}
            <Button label="Create QR code" icon="qr-code-2" full loading={creating} onPress={() => create()} />
            <Button label="Revoke code for this session" variant="secondary" full loading={revoking}
              onPress={() => confirm('Revoke the code for this session?', `Session "${session.trim() || 'default'}" will stop accepting scans.`, 'Revoke', () => { void revoke(); })} />
          </>
        )}
        {error ? <Banner tone="error" message={error} /> : null}
      </View>
    </Sheet>
  );
}
