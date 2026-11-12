/**
 * Test runner engine. One hook owns: attempt state from the server, the server-synced clock, debounced autosave with an
 * offline retry queue (persisted on the device), sequential-section rules, proctor event logging (events only, never any
 * blocking of screenshots), and submit / auto-submit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useIsOnline } from '@/ui';
import { ApiError } from '@/api/client';
import {
  enterSection, fetchAttempt, isAttemptOver, postEvents, putAnswers, submitAttempt,
} from '@/api/tests';
import type {
  AnswerItem, AnswerValue, AttemptMeta, AttemptSection, AttemptState, CodeSubmission, CodeSummary, ProctorEvent, ProctorEventType,
  StudentQuestion,
} from '@/api/testsTypes';
import { readJson, removeJson, writeJson } from './store';
import { isAnswered, isNumericText, netMessage } from './kit';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'offline' | 'error';

interface Pending {
  questionId: string;
  hasAnswer: boolean;
  answer?: AnswerValue;
  hasFlag: boolean;
  flagged?: boolean;
  clientTs: number;
}
interface Persisted {
  v: 1;
  pending: Pending[];
  visited: string[];
  submittedCode: Record<string, string>;
}
export interface LocalAnswer { answer: AnswerValue | undefined; flagged: boolean }

const BATCH = 20;
const CODING_DEBOUNCE = 1500;
const TEXT_DEBOUNCE = 700;

function normalizeIn(q: StudentQuestion | undefined, v: AnswerValue | undefined): AnswerValue | undefined {
  if (v === null || v === undefined) return undefined;
  if (q?.type === 'numeric' && typeof v === 'number') return String(v);
  return v;
}
const toItem = (p: Pending): AnswerItem => {
  const it: AnswerItem = { questionId: p.questionId, clientTs: p.clientTs };
  if (p.hasAnswer) it.answer = p.answer === undefined ? null : p.answer;
  if (p.hasFlag) it.flagged = !!p.flagged;
  return it;
};

export function useAttemptSession(attemptId: string) {
  const online = useIsOnline();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode / fast refresh re-run the effect: the flag must come back to true
    return () => { alive.current = false; };
  }, []);

  /* ----------------------------- server state */
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [meta, setMeta] = useState<AttemptMeta | null>(null);
  const [assessment, setAssessment] = useState<AttemptState['assessment'] | null>(null);
  const [sections, setSections] = useState<AttemptSection[]>([]);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  const [codeInfo, setCodeInfo] = useState<Record<string, CodeSummary>>({});
  const [submittedCode, setSubmittedCode] = useState<Record<string, string>>({});
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [curId, setCurId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const offsetRef = useRef(0);
  const questionsRef = useRef<StudentQuestion[]>([]);
  questionsRef.current = questions;
  const sectionsRef = useRef<AttemptSection[]>([]);
  sectionsRef.current = sections;
  const metaRef = useRef<AttemptMeta | null>(null);
  metaRef.current = meta;
  const finishedRef = useRef(false);
  finishedRef.current = finished;

  /**
   * offset = serverNow - deviceNow. `at` is the device time the server stamped its clock: the midpoint of the request, not the
   * moment the (possibly slow) response arrived, so a 4 s response does not make the countdown 4 s too long.
   */
  const applyServerNow = useCallback((iso?: string, at?: number) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(t)) offsetRef.current = t - (at ?? Date.now());
  }, []);

  /* ----------------------------- clock */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNowTick(Date.now()); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  const serverNow = nowTick + offsetRef.current;
  const deadlineMs = meta ? Date.parse(meta.deadlineAt) : 0;
  const remainingMs = meta ? Math.max(0, deadlineMs - serverNow) : 0;
  const totalMs = assessment ? assessment.durationMinutes * 60_000 : Math.max(remainingMs, 1);

  /* ----------------------------- save queue */
  const pendingRef = useRef<Map<string, Pending>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const flushing = useRef(false);
  const flushAgain = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(3000);
  const lastTs = useRef(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visitedRef = useRef(visited);
  visitedRef.current = visited;
  const submittedCodeRef = useRef(submittedCode);
  submittedCodeRef.current = submittedCode;

  const persistNow = useCallback(() => {
    if (finishedRef.current) return;
    const data: Persisted = {
      v: 1,
      pending: [...pendingRef.current.values()],
      visited: [...visitedRef.current],
      submittedCode: submittedCodeRef.current,
    };
    writeJson(`attempt-${attemptId}`, data);
  }, [attemptId]);
  const persistSoon = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(persistNow, 500);
  }, [persistNow]);

  const syncCount = useCallback(() => setPendingCount(pendingRef.current.size), []);

  const nextTs = () => {
    lastTs.current = Math.max(Date.now(), lastTs.current + 1);
    return lastTs.current;
  };

  /* ----------------------------- finishing */
  const markFinished = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    pendingRef.current.clear();
    syncCount();
    removeJson(`attempt-${attemptId}`);
    if (alive.current) setFinished(true);
  }, [attemptId, syncCount]);

  const applyState = useCallback((s: AttemptState, initial: boolean, persisted?: Persisted | null, sampledAt?: number) => {
    applyServerNow(s.serverNow, sampledAt);
    setMeta(s.attempt);
    setAssessment(s.assessment);
    setSections(s.sections);
    setQuestions(s.questions);
    setCodeInfo(s.code ?? {});
    if (s.attempt.status === 'submitted') {
      markFinished();
      return;
    }
    const byId = new Map(s.questions.map((q) => [q.id, q]));
    const fromServer: Record<string, LocalAnswer> = {};
    for (const [qid, a] of Object.entries(s.answers ?? {})) {
      fromServer[qid] = { answer: normalizeIn(byId.get(qid), a.answer), flagged: !!a.flagged };
    }
    if (initial) {
      const merged = { ...fromServer };
      if (persisted) {
        for (const p of persisted.pending) {
          if (!byId.has(p.questionId)) continue;
          const savedAt = s.answers?.[p.questionId]?.savedAt;
          const serverMs = savedAt ? Date.parse(savedAt) : 0;
          // keep device edits only when they are newer than what the server holds (server clock corrected)
          if (p.clientTs + offsetRef.current < serverMs) continue;
          const cur = merged[p.questionId] ?? { answer: undefined, flagged: false };
          if (p.hasAnswer) cur.answer = normalizeIn(byId.get(p.questionId), p.answer);
          if (p.hasFlag) cur.flagged = !!p.flagged;
          merged[p.questionId] = cur;
          pendingRef.current.set(p.questionId, p);
          lastTs.current = Math.max(lastTs.current, p.clientTs);
        }
        setSubmittedCode(persisted.submittedCode ?? {});
      }
      setAnswers(merged);
      const vis = new Set<string>(persisted?.visited ?? []);
      for (const k of Object.keys(merged)) vis.add(k);
      setVisited(vis);
      syncCount();
      const first = s.questions.slice().sort((a, b) => a.number - b.number)[0];
      setCurId((c) => c ?? first?.id ?? null);
    } else {
      setAnswers((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(fromServer)) if (!next[k]) next[k] = v;
        return next;
      });
      setCurId((c) => (c && byId.has(c) ? c : (s.questions[0]?.id ?? null)));
    }
  }, [applyServerNow, markFinished, syncCount]);

  const load = useCallback(async (initial: boolean): Promise<AttemptState | null> => {
    try {
      const t0 = Date.now();
      const s = await fetchAttempt(attemptId);
      const sampledAt = Math.round((t0 + Date.now()) / 2);
      const persisted = initial ? await readJson<Persisted>(`attempt-${attemptId}`) : null;
      if (!alive.current) return s;
      applyState(s, initial, persisted, sampledAt);
      if (initial) setPhase('ready');
      return s;
    } catch (e) {
      if (!alive.current) return null;
      if (initial) {
        setLoadError(e);
        setPhase('error');
      }
      return null;
    }
  }, [attemptId, applyState]);

  useEffect(() => {
    void load(true);
  }, [load]);

  /* ----------------------------- flush */
  const scheduleRetry = useCallback((fn: () => void) => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(fn, retryDelay.current);
    retryDelay.current = Math.min(30_000, retryDelay.current * 2);
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    if (finishedRef.current) return true;
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    if (flushing.current) { flushAgain.current = true; return false; }
    if (pendingRef.current.size === 0) { setSaveStatus('saved'); return true; }
    flushing.current = true;
    setSaveStatus('saving');
    let ok = true;
    try {
      while (pendingRef.current.size > 0) {
        const batch = [...pendingRef.current.values()].slice(0, BATCH).map((p) => ({ ...p }));
        const t0 = Date.now();
        const res = await putAnswers(attemptId, batch.map(toItem));
        applyServerNow(res.serverNow, Math.round((t0 + Date.now()) / 2));
        for (const b of batch) {
          const cur = pendingRef.current.get(b.questionId);
          if (cur && cur.clientTs === b.clientTs) pendingRef.current.delete(b.questionId);
        }
        if (res.rejected?.length) {
          setSaveNote('Some answers were not saved because their section is closed.');
          void load(false);
        } else setSaveNote(null);
        retryDelay.current = 3000;
        syncCount();
      }
      setSaveStatus('saved');
    } catch (e) {
      ok = false;
      if (e instanceof ApiError && isAttemptOver(e)) {
        await load(false);
        markFinished();
      } else if (e instanceof ApiError && e.code === 'SECTION_CLOSED') {
        // Everything pending belongs to closed sections. Refresh sections, drop those edits, say so.
        pendingRef.current.clear();
        syncCount();
        setSaveNote('Those answers were not saved because their section is closed.');
        setSaveStatus('saved');
        void load(false);
      } else if (e instanceof ApiError && e.status === 400) {
        // Drop the offending items so one bad value cannot block the queue.
        const idx = new Set<number>();
        for (const k of Object.keys(e.fields ?? {})) {
          const m = /answers\.(\d+)/.exec(k);
          if (m) idx.add(Number(m[1]));
        }
        const first = [...pendingRef.current.values()].slice(0, BATCH);
        const drop = idx.size ? first.filter((_, i) => idx.has(i)) : first;
        drop.forEach((p) => pendingRef.current.delete(p.questionId));
        syncCount();
        setSaveNote('One answer could not be saved because its format was not accepted.');
        setSaveStatus('error');
        if (pendingRef.current.size) scheduleRetry(() => void flush());
      } else if (e instanceof ApiError && e.isNetwork) {
        setSaveStatus('offline');
        scheduleRetry(() => void flush());
      } else {
        setSaveStatus('error');
        setSaveNote(netMessage(e, 'Saving failed.'));
        scheduleRetry(() => void flush());
      }
    } finally {
      flushing.current = false;
      persistNow();
      if (flushAgain.current && alive.current && !finishedRef.current) {
        flushAgain.current = false;
        setTimeout(() => void flush(), 0);
      }
    }
    return ok && pendingRef.current.size === 0;
  }, [attemptId, applyServerNow, load, markFinished, persistNow, scheduleRetry, syncCount]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Edits restored from the device after an app kill are sent as soon as the attempt is on screen (not only on the next edit).
  useEffect(() => {
    if (phase === 'ready' && pendingRef.current.size > 0 && !finishedRef.current) {
      setSaveStatus('unsaved');
      debounceTimer.current = setTimeout(() => void flushRef.current(), 400);
    }
  }, [phase]);

  const scheduleFlush = useCallback((ms: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void flushRef.current(), ms);
  }, []);

  const enqueue = useCallback((qid: string, patch: { answer?: AnswerValue; flag?: boolean }, delay: number, immediate = false) => {
    const cur: Pending = pendingRef.current.get(qid) ?? { questionId: qid, hasAnswer: false, hasFlag: false, clientTs: 0 };
    if ('answer' in patch) { cur.hasAnswer = true; cur.answer = patch.answer ?? null; }
    if (patch.flag !== undefined) { cur.hasFlag = true; cur.flagged = patch.flag; }
    cur.clientTs = nextTs();
    pendingRef.current.set(qid, cur);
    syncCount();
    setSaveStatus((s) => (s === 'offline' ? s : 'unsaved'));
    scheduleFlush(delay);
    // taps (options, flags) are written to the device at once; typing is batched to keep the editor responsive
    if (immediate) persistNow(); else persistSoon();
  }, [persistNow, persistSoon, scheduleFlush, syncCount]);

  /* ----------------------------- section state */
  const isSequential = useMemo(() => sections.some((s) => s.timeLimitMinutes !== null && s.timeLimitMinutes !== undefined), [sections]);
  const sectionClosed = useCallback((sid: string, atMs = serverNow) => {
    const s = sectionsRef.current.find((x) => x.id === sid);
    if (!s) return false;
    if (s.locked) return true;
    return !!s.deadlineAt && atMs >= Date.parse(s.deadlineAt);
  }, [serverNow]);

  /* ----------------------------- edits */
  const answersRef = useRef<Record<string, LocalAnswer>>({});
  answersRef.current = answers;
  const patchAnswer = useCallback((qid: string, patch: Partial<LocalAnswer>) => {
    const next = { ...answersRef.current, [qid]: { answer: answersRef.current[qid]?.answer, flagged: answersRef.current[qid]?.flagged ?? false, ...patch } };
    answersRef.current = next;
    setAnswers(next);
  }, []);

  const setAnswer = useCallback((qid: string, value: AnswerValue | undefined) => {
    const q = questionsRef.current.find((x) => x.id === qid);
    if (!q || finishedRef.current) return;
    patchAnswer(qid, { answer: value });
    let send: AnswerValue = value === undefined ? null : value;
    if (q.type === 'numeric') {
      const t = typeof value === 'string' ? value.trim() : '';
      if (t === '') send = null;
      else if (!isNumericText(t)) return; // invalid text stays local only
      else send = t;
    }
    if (q.type === 'short_text' && typeof value === 'string') send = value.slice(0, 500);
    enqueue(qid, { answer: send }, q.type === 'coding' ? CODING_DEBOUNCE : TEXT_DEBOUNCE, q.type === 'mcq_single' || q.type === 'mcq_multi');
  }, [enqueue, patchAnswer]);

  const toggleFlag = useCallback((qid: string) => {
    if (finishedRef.current) return;
    const next = !(answersRef.current[qid]?.flagged ?? false);
    patchAnswer(qid, { flagged: next });
    enqueue(qid, { flag: next }, 300, true);
  }, [enqueue, patchAnswer]);

  const goTo = useCallback((qid: string) => {
    const q = questionsRef.current.find((x) => x.id === qid);
    if (!q) return;
    void flushRef.current();
    setCurId(qid);
    setVisited((v) => (v.has(qid) ? v : new Set(v).add(qid)));
    persistSoon();
  }, [persistSoon]);

  useEffect(() => {
    if (curId) setVisited((v) => (v.has(curId) ? v : new Set(v).add(curId)));
  }, [curId]);

  const ordered = useMemo(() => questions.slice().sort((a, b) => a.number - b.number), [questions]);
  const curQuestion = ordered.find((q) => q.id === curId) ?? null;
  const curSection = curQuestion ? sections.find((s) => s.id === curQuestion.sectionId) ?? null : null;

  /** Open sections the student may move around in (earlier sections are locked in sequential mode). */
  const navigable = useMemo(
    () => ordered.filter((q) => {
      const s = sections.find((x) => x.id === q.sectionId);
      return !!s && (!isSequential || !s.locked);
    }),
    [ordered, sections, isSequential],
  );
  const curIndex = navigable.findIndex((q) => q.id === curId);
  const goNext = () => { const n = navigable[curIndex + 1]; if (n) goTo(n.id); };
  const goPrev = () => { const n = navigable[curIndex - 1]; if (n) goTo(n.id); };
  const goSection = (sid: string) => {
    const first = ordered.find((q) => q.sectionId === sid);
    if (first) goTo(first.id);
  };

  const nextUnopened = useMemo(() => sections.find((s) => !s.enteredAt && !s.locked) ?? null, [sections]);
  const [entering, setEntering] = useState(false);
  const enteringRef = useRef(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const enterNext = useCallback(async (): Promise<boolean> => {
    const target = sectionsRef.current.find((s) => !s.enteredAt && !s.locked);
    if (!target || enteringRef.current) return false;
    enteringRef.current = true; // a ref: two quick taps in the same frame must not send two requests
    setEntering(true);
    setSectionError(null);
    try {
      await flushRef.current();
      const r = await enterSection(attemptId, target.id);
      if (!alive.current) return true;
      const idx = sectionsRef.current.findIndex((s) => s.id === target.id);
      setSections((prev) => prev.map((s, i) => {
        if (s.id === target.id) return { ...s, enteredAt: r.section.enteredAt, deadlineAt: r.section.deadlineAt, locked: r.section.locked };
        if (i < idx) return { ...s, locked: true };
        return s;
      }));
      setQuestions((prev) => {
        const have = new Set(prev.map((q) => q.id));
        return [...prev, ...r.questions.filter((q) => !have.has(q.id))];
      });
      const first = r.questions.slice().sort((a, b) => a.number - b.number)[0];
      if (first) { setCurId(first.id); setVisited((v) => new Set(v).add(first.id)); }
      return true;
    } catch (e) {
      if (!alive.current) return false;
      if (e instanceof ApiError && isAttemptOver(e)) { await load(false); markFinished(); }
      else if (e instanceof ApiError && e.code === 'SECTION_NOT_NEXT') {
        setSectionError('That section is not the next one. Your sections have been refreshed.');
        await load(false);
      } else setSectionError(netMessage(e, 'Could not open the next section.'));
      return false;
    } finally {
      enteringRef.current = false;
      if (alive.current) setEntering(false);
    }
  }, [attemptId, load, markFinished]);

  /**
   * Destructive automatic steps (auto-open next section, auto-submit) must not trust a device clock that was changed or drifted:
   * re-read the attempt from the server (refreshes the offset) and only then compare against the deadline.
   */
  const lastVerify = useRef(0);
  const verifying = useRef(false);
  /** 'yes' / 'no' from a fresh server read, 'unknown' when it could not be read right now (offline, throttled). */
  const confirmExpired = useCallback(async (deadlineIso: string): Promise<'yes' | 'no' | 'unknown'> => {
    if (verifying.current || Date.now() - lastVerify.current < 3000) return 'unknown';
    verifying.current = true;
    try {
      const s = await load(false);
      lastVerify.current = Date.now();
      if (!s || finishedRef.current) return 'unknown';
      return Date.now() + offsetRef.current >= Date.parse(deadlineIso) ? 'yes' : 'no';
    } finally {
      verifying.current = false;
    }
  }, [load]);

  // Timed section ran out: move on automatically (its answers are already locked on the server).
  const autoEntered = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isSequential || !curSection || finished || !curSection.deadlineAt) return;
    if (serverNow < Date.parse(curSection.deadlineAt)) return;
    if (autoEntered.current.has(curSection.id) || !nextUnopened) return;
    const sid = curSection.id;
    const deadline = curSection.deadlineAt;
    autoEntered.current.add(sid);
    void (async () => {
      let opened = false;
      if ((await confirmExpired(deadline)) === 'yes') opened = await enterNext();
      // not confirmed (clock skew, offline) or failed: allow another try
      if (!opened && alive.current) autoEntered.current.delete(sid);
    })();
  }, [isSequential, curSection, serverNow, finished, nextUnopened, enterNext, confirmExpired]);

  /* ----------------------------- code bookkeeping */
  const noteCodeSubmitted = useCallback((qid: string, code: string, sub: CodeSubmission | null) => {
    setSubmittedCode((p) => ({ ...p, [qid]: code }));
    setCodeInfo((prev) => {
      const old = prev[qid] ?? { submissions: 0, best: null, pending: false };
      if (!sub || sub.status === 'pending_judge') return { ...prev, [qid]: { ...old, submissions: old.submissions + 1, pending: true } };
      return {
        ...prev,
        [qid]: {
          submissions: old.submissions + 1,
          pending: old.pending,
          best: { passed: sub.best.passed, total: sub.best.total, score: sub.score, maxScore: sub.maxScore, verdict: sub.best.verdict as never },
        },
      };
    });
    persistSoon();
  }, [persistSoon]);

  /* ----------------------------- proctor events */
  const events = useRef<ProctorEvent[]>([]);
  const eventSeq = useRef(0);
  const sendingEvents = useRef(false);
  const [warnings, setWarnings] = useState(0);
  const [maxWarnings, setMaxWarnings] = useState<number | null>(null);
  const [leftCount, setLeftCount] = useState(0);
  useEffect(() => {
    if (meta) { setWarnings((w) => Math.max(w, meta.warnings)); setMaxWarnings(meta.maxWarnings); }
  }, [meta]);

  const sendEvents = useCallback(async () => {
    if (sendingEvents.current || events.current.length === 0 || finishedRef.current) return;
    sendingEvents.current = true;
    try {
      const batch = events.current.slice(0, 20);
      const r = await postEvents(attemptId, batch);
      events.current = events.current.slice(batch.length);
      if (!alive.current) return;
      setWarnings(r.warnings);
      setMaxWarnings(r.maxWarnings);
      if (r.autoSubmitted || r.status === 'submitted') { await load(false); markFinished(); }
      else if (events.current.length) setTimeout(() => void sendEvents(), 0);
    } catch (e) {
      if (e instanceof ApiError && !e.isNetwork && e.status >= 400 && e.status < 500) {
        if (isAttemptOver(e)) { await load(false); markFinished(); }
        events.current = []; // not retryable
      }
      // network problems: keep the events, they are retried on reconnect / next foreground
    } finally {
      sendingEvents.current = false;
    }
  }, [attemptId, load, markFinished]);

  const logEvent = useCallback((type: ProctorEventType) => {
    if (finishedRef.current) return;
    eventSeq.current += 1;
    const ts = Date.now();
    if (events.current.length >= 200) events.current.shift(); // flapping network while offline must not grow without bound
    events.current.push({ type, clientTs: ts, eventId: `${attemptId.slice(0, 8)}-${eventSeq.current}-${ts}`.slice(0, 64) });
    void sendEvents();
  }, [attemptId, sendEvents]);

  useEffect(() => {
    if (phase !== 'ready' || finished) return;
    let prev: AppStateStatus = (AppState.currentState ?? 'active') as AppStateStatus;
    const sub = AppState.addEventListener('change', (next) => {
      if (prev === 'active' && next === 'inactive') { logEvent('focus_lost'); setLeftCount((n) => n + 1); }
      else if (prev === 'active' && next === 'background') { logEvent('app_background'); setLeftCount((n) => n + 1); }
      // inactive -> background is the same departure already counted
      if (next !== 'active') {
        persistNow();
        void flushRef.current();
      } else if (prev !== 'active') {
        logEvent('focus_regained');
        void sendEvents();
        void flushRef.current();
        void load(false); // resync the clock and catch a server-side submit
      }
      prev = next;
    });
    return () => sub.remove();
  }, [phase, finished, logEvent, persistNow, sendEvents, load]);

  // connectivity changes
  const wasOnline = useRef(true);
  const lastOfflineEvent = useRef(0);
  useEffect(() => {
    if (phase !== 'ready' || finished) return;
    if (!online && wasOnline.current && Date.now() - lastOfflineEvent.current > 20_000) {
      lastOfflineEvent.current = Date.now();
      logEvent('network_offline');
    }
    if (online && !wasOnline.current) {
      retryDelay.current = 3000;
      void flushRef.current();
      void sendEvents();
    }
    wasOnline.current = online;
  }, [online, phase, finished, logEvent, sendEvents]);

  /* ----------------------------- submit */
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitting_ = useRef(false);
  const submit = useCallback(async (): Promise<boolean> => {
    if (submitting_.current || finishedRef.current) return false;
    submitting_.current = true;
    setSubmitting(true);
    setSubmitError(null);
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    try {
      // Send unsaved edits atomically together with the submit (the body takes at most 100; more are flushed first).
      if (pendingRef.current.size > 100) await flushRef.current();
      const items = [...pendingRef.current.values()].slice(0, 100).map(toItem);
      try {
        await submitAttempt(attemptId, items);
      } catch (e) {
        // One stale or rejected edit (closed section, bad format) must never block the submit itself: the server already holds
        // everything autosave sent, so submit again without the extra edits.
        const rejectedEdits = e instanceof ApiError && !isAttemptOver(e) && items.length > 0 && (e.code === 'SECTION_CLOSED' || e.status === 400);
        if (!rejectedEdits) throw e;
        pendingRef.current.clear();
        syncCount();
        await submitAttempt(attemptId, []);
      }
      if (alive.current) markFinished();
      return true;
    } catch (e) {
      if (e instanceof ApiError && isAttemptOver(e)) {
        await load(false);
        markFinished();
        return true;
      }
      if (alive.current) setSubmitError(netMessage(e, 'Could not submit. Please try again.'));
      return false;
    } finally {
      submitting_.current = false;
      if (alive.current) setSubmitting(false);
    }
  }, [attemptId, load, markFinished, syncCount]);

  // Auto-submit at the server deadline; retry until the server confirms. The expiry is verified against a fresh server read first,
  // so a changed phone clock cannot end the test early.
  const [timeUp, setTimeUp] = useState(false);
  // Offline well past the deadline by the local clock: stop accepting edits (cosmetic lock only; nothing is submitted until verified).
  const [lockedOffline, setLockedOffline] = useState(false);
  useEffect(() => {
    if (phase !== 'ready' || finished || timeUp || !meta || serverNow < deadlineMs) return;
    if (!online && serverNow - deadlineMs > 15_000) setLockedOffline(true);
    void confirmExpired(meta.deadlineAt).then((r) => {
      if (!alive.current || finishedRef.current) return;
      if (r === 'yes') setTimeUp(true);
      else if (r === 'no') setLockedOffline(false);
    });
  }, [phase, finished, timeUp, meta, serverNow, deadlineMs, confirmExpired, online]);
  useEffect(() => {
    if (!timeUp || finished) return;
    void submit();
    const id = setInterval(() => void submit(), 4000);
    return () => clearInterval(id);
  }, [timeUp, finished, submit]);

  // Cleanup timers
  useEffect(() => () => {
    [debounceTimer, retryTimer, persistTimer].forEach((t) => t.current && clearTimeout(t.current));
    // Leaving the screen with edits still waiting (back during the debounce): keep them on the device and try to send them.
    if (!finishedRef.current && pendingRef.current.size > 0) {
      persistNow();
      void flushRef.current();
    }
  }, [persistNow]);

  /* ----------------------------- derived: palette + summary */
  const starterOf = (q: StudentQuestion, a?: LocalAnswer): string => {
    if (q.type !== 'coding') return '';
    const lang = a && typeof a.answer === 'object' && a.answer && 'language' in a.answer ? a.answer.language : q.coding?.languages[0];
    return (lang && q.coding?.starterCode?.[lang]) || '';
  };
  const statusOf = useCallback((q: StudentQuestion): 'answered' | 'flagged' | 'visited' | 'unvisited' => {
    const a = answers[q.id];
    if (a?.flagged) return 'flagged';
    if (isAnswered(q, a?.answer, starterOf(q, a))) return 'answered';
    return visited.has(q.id) ? 'visited' : 'unvisited';
  }, [answers, visited]); // eslint-disable-line react-hooks/exhaustive-deps
  const answeredOf = useCallback((q: StudentQuestion) => isAnswered(q, answers[q.id]?.answer, starterOf(q, answers[q.id])), [answers]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const rows = sections.map((s) => {
      const qs = ordered.filter((q) => q.sectionId === s.id);
      const answered = qs.filter((q) => answeredOf(q)).length;
      const flagged = qs.filter((q) => answers[q.id]?.flagged).length;
      const unvisited = qs.filter((q) => !visited.has(q.id) && !answeredOf(q)).length;
      const notOpened = !s.enteredAt && s.questionIds.length > 0 && qs.length === 0;
      return { section: s, total: notOpened ? s.questionIds.length : qs.length, answered, flagged, unanswered: (notOpened ? s.questionIds.length : qs.length) - answered, unvisited, notOpened };
    });
    const unsubmittedCoding = ordered.filter((q) => {
      if (q.type !== 'coding') return false;
      const a = answers[q.id]?.answer;
      if (!isAnswered(q, a, starterOf(q, answers[q.id]))) return false;
      const code = typeof a === 'object' && a && 'code' in a ? a.code : '';
      return (submittedCode[q.id] ?? '') !== code;
    });
    return {
      rows,
      total: rows.reduce((n, r) => n + r.total, 0),
      answered: rows.reduce((n, r) => n + r.answered, 0),
      flagged: rows.reduce((n, r) => n + r.flagged, 0),
      unanswered: rows.reduce((n, r) => n + r.unanswered, 0),
      unvisited: rows.reduce((n, r) => n + r.unvisited, 0),
      unsubmittedCoding,
    };
  }, [sections, ordered, answers, visited, submittedCode, answeredOf]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    phase, loadError, reload: () => { setPhase('loading'); void load(true); },
    meta, assessment, sections, questions: ordered, answers, codeInfo, submittedCode,
    curQuestion, curSection, curIndex, navigable, goTo, goNext, goPrev, goSection,
    setAnswer, toggleFlag, statusOf, answeredOf, summary,
    isSequential, sectionClosed, nextUnopened, enterNext, entering, sectionError,
    remainingMs, totalMs, serverNow, timeUp, locked: timeUp || lockedOffline,
    saveStatus, saveNote, pendingCount, flush,
    warnings, maxWarnings, leftCount,
    submit, submitting, submitError,
    noteCodeSubmitted,
    finished,
    online,
  };
}
