import { useCallback, useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import NetInfo from '@react-native-community/netinfo';
import type { UploadPurpose, UploadedFile } from '@/api/integrationsTypes';
import { useFeatures } from '@/config/features';
import { RULES, checkPicked, startUpload, type PickedFile, type UploadHandle, type UploadStage } from './uploadFile';

export type UploadPhase = 'idle' | 'working' | 'done' | 'error';

export interface UploadState {
  phase: UploadPhase;
  stage: UploadStage | null;
  /** 0..1 while stage === 'upload' */
  progress: number;
  file: PickedFile | null;
  result: UploadedFile | null;
  error: { message: string; retryable: boolean; code: string } | null;
}

const IDLE: UploadState = { phase: 'idle', stage: null, progress: 0, file: null, result: null, error: null };

/**
 * State machine for one upload slot.
 *   const up = useFileUpload('resume');
 *   up.pick()      // opens the system file picker, validates, uploads
 *   up.cancel()    // aborts an in-flight upload (state returns to idle)
 *   up.retry()     // re-runs the failed step (confirm-only when the bytes already went up)
 *   up.reset()     // back to idle (does not delete the stored file)
 * `up.enabled` is false when the server reports fileUploads off.
 */
export function useFileUpload(purpose: UploadPurpose, opts: { onDone?: (file: UploadedFile, picked: PickedFile) => void } = {}) {
  const { flags, config } = useFeatures();
  const [state, setState] = useState<UploadState>(IDLE);
  const handle = useRef<UploadHandle | null>(null);
  const lastFile = useRef<PickedFile | null>(null);
  const resumeId = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  const busy = useRef(false);
  const onDone = useRef(opts.onDone);
  onDone.current = opts.onDone;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      handle.current?.cancel();
    };
  }, []);

  const run = useCallback(
    async (file: PickedFile) => {
      if (busy.current) return;
      busy.current = true;
      lastFile.current = file;
      setState({ ...IDLE, phase: 'working', stage: 'checking', file });
      try {
        const net = await NetInfo.fetch();
        if (net.isConnected === false || net.isInternetReachable === false) {
          setState({ ...IDLE, phase: 'error', file, error: { message: 'You are offline. Connect to the internet and retry.', retryable: true, code: 'OFFLINE' } });
          return;
        }
        const h = startUpload({
          purpose,
          file,
          limits: config.limits,
          resumeFileId: resumeId.current,
          onStage: (stage) => alive.current && setState((s) => (s.phase === 'working' ? { ...s, stage } : s)),
          onProgress: (progress) => alive.current && setState((s) => (s.phase === 'working' ? { ...s, progress } : s)),
        });
        handle.current = h;
        const result = await h.promise;
        resumeId.current = undefined;
        if (!alive.current) return;
        setState({ phase: 'done', stage: null, progress: 1, file, result, error: null });
        onDone.current?.(result, file);
      } catch (e) {
        if (!alive.current) return;
        const err = e as { message?: string; retryable?: boolean; code?: string; fileId?: string };
        if (err.code === 'CANCELLED') {
          setState(IDLE);
          return;
        }
        resumeId.current = err.fileId;
        setState({ phase: 'error', stage: null, progress: 0, file, result: null, error: { message: err.message ?? 'Upload failed.', retryable: err.retryable !== false, code: err.code ?? 'UNKNOWN' } });
      } finally {
        handle.current = null;
        busy.current = false;
      }
    },
    [purpose, config.limits],
  );

  const pick = useCallback(async () => {
    if (busy.current) return;
    let res: DocumentPicker.DocumentPickerResult;
    try {
      res = await DocumentPicker.getDocumentAsync({ type: RULES[purpose].types, copyToCacheDirectory: true, multiple: false });
    } catch {
      setState({ ...IDLE, phase: 'error', error: { message: 'Could not open the file picker.', retryable: false, code: 'PICKER' } });
      return;
    }
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const file: PickedFile = { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size };
    resumeId.current = undefined;
    const bad = checkPicked(purpose, file, config.limits);
    if (bad) {
      setState({ ...IDLE, phase: 'error', file, error: { message: bad, retryable: false, code: 'INVALID_FILE' } });
      return;
    }
    await run(file);
  }, [purpose, config.limits, run]);

  const retry = useCallback(async () => {
    if (lastFile.current) await run(lastFile.current);
  }, [run]);

  const cancel = useCallback(() => {
    handle.current?.cancel();
    if (!busy.current) setState(IDLE);
  }, []);

  const reset = useCallback(() => {
    handle.current?.cancel();
    resumeId.current = undefined;
    lastFile.current = null;
    setState(IDLE);
  }, []);

  return { ...state, enabled: flags.fileUploads === true, limits: config.limits, pick, retry, cancel, reset };
}
