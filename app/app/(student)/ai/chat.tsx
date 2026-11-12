import React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, ErrorState, HeaderAction, Skeleton, Text } from '@/ui';
import { Icon } from '@/ui';
import { colors, fontFamilyFor, MIN_TOUCH, radius, SCREEN_PADDING } from '@/theme';
import { Page, sp } from '@/features/student/me/kit';
import { ApiError, errMessage } from '@/api/client';
import { aiErrorInfo, aiKeys, aiErrorKind, streamChat, useAiStatus, useConversation, useSuggestedPrompts } from '@/api/ai';
import type { AiIntent, ChatMessage } from '@/api/aiTypes';
import { useFeatures } from '@/config/features';
import { AiGate, AI_ROUTES, CopyShareRow, QuotaMeter, useGo } from '@/features/ai/kit';

interface Msg { key: string; role: 'user' | 'assistant'; content: string; draft?: boolean; streaming?: boolean; stopped?: boolean }
const fromServer = (m: ChatMessage): Msg => ({ key: m.id, role: m.role, content: m.content, draft: m.draft });

export default function AiChat() {
  const router = useRouter();
  const go = useGo();
  const onOpenPrivacy = () => go(AI_ROUTES.consent);
  const { flags } = useFeatures();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; driveId?: string; prompt?: string }>();
  const driveId = typeof params.driveId === 'string' ? params.driveId : undefined;

  const [conversationId, setConversationId] = React.useState<string | undefined>(typeof params.id === 'string' ? params.id : undefined);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState(typeof params.prompt === 'string' ? params.prompt : '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const [failed, setFailed] = React.useState<{ text: string; intent?: AiIntent } | null>(null);
  const [generalMode, setGeneralMode] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const loadedRef = React.useRef(false);
  const sendingRef = React.useRef(false); // synchronous double-tap guard: `busy` state updates one render too late

  const status = useAiStatus(flags.ai === true);
  const history = useConversation(typeof params.id === 'string' ? params.id : undefined);
  const prompts = useSuggestedPrompts(driveId, messages.length === 0);

  React.useEffect(() => () => abortRef.current?.abort(), []);
  React.useEffect(() => {
    if (history.data && !loadedRef.current) {
      loadedRef.current = true;
      // never replace a turn the student already started while the old conversation was still loading
      setMessages((cur) => (cur.length ? cur : history.data!.messages.map(fromServer)));
    }
  }, [history.data]);

  const quota = status.data?.quota;
  const outOfQuota = !!quota && quota.remaining <= 0;
  const consentOff = status.data ? !status.data.consent.granted : false;

  const send = React.useCallback(async (raw: string, intent?: AiIntent) => {
    const text = raw.trim();
    if (!text || busy || sendingRef.current) return;
    sendingRef.current = true;
    const userKey = `u-${Date.now()}`;
    const aKey = `a-${Date.now()}`;
    setError(null);
    setFailed(null);
    setBusy(true);
    setInput('');
    setMessages((m) => [...m, { key: userKey, role: 'user', content: text }, { key: aKey, role: 'assistant', content: '', streaming: true }]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await streamChat(
        { message: text, conversationId, driveId, intent },
        {
          signal: ac.signal,
          onMeta: (m) => setConversationId(m.conversationId),
          onDelta: (t) => setMessages((m) => m.map((x) => (x.key === aKey ? { ...x, content: x.content + t } : x))),
        },
      );
      setConversationId(res.conversationId);
      setGeneralMode(res.consentRequired === true);
      setMessages((m) => m.map((x) => (x.key === aKey ? { key: res.message.id, role: 'assistant', content: res.message.content, draft: res.message.draft } : x)));
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
    } catch (e) {
      if (ac.signal.aborted) {
        setMessages((m) => m.map((x) => (x.key === aKey ? { ...x, streaming: false, stopped: true } : x)).filter((x) => !(x.key === aKey && !x.content)));
      } else {
        setMessages((m) => m.filter((x) => x.key !== aKey && x.key !== userKey));
        setFailed({ text, intent });
        setInput(text);
        setError(e instanceof ApiError ? e : new Error(errMessage(e)));
      }
    } finally {
      abortRef.current = null;
      sendingRef.current = false;
      setBusy(false);
      void qc.invalidateQueries({ queryKey: aiKeys.status });
      void qc.invalidateQueries({ queryKey: aiKeys.usage });
    }
  }, [busy, conversationId, driveId, qc]);

  const newChat = () => {
    abortRef.current?.abort();
    loadedRef.current = true;
    setConversationId(undefined);
    setMessages([]);
    setError(null);
    setFailed(null);
    setInput('');
    router.setParams({ id: undefined as never, prompt: undefined as never });
  };

  const kind = error ? aiErrorKind(error) : null;
  const info = error ? aiErrorInfo(error) : null;
  const openingOld = typeof params.id === 'string' && history.isLoading; // composer waits until the old messages are on screen
  const canSend = input.trim().length > 0 && !busy && !outOfQuota && kind !== 'quota' && !openingOld;

  const composer = (
    <View style={{ gap: sp.sm }}>
      {error && info ? (
        <Banner
          tone={kind === 'quota' || kind === 'rate' || kind === 'consent' ? 'warning' : 'error'}
          title={info.title}
          message={info.message}
          action={kind === 'consent' ? { label: 'Open AI privacy', onPress: onOpenPrivacy } : info.retryable && failed ? { label: 'Send again', onPress: () => void send(failed.text, failed.intent) } : undefined}
        />
      ) : null}
      {outOfQuota && !error ? <Banner tone="warning" title="Daily AI limit reached" message="You have used all of today's AI requests. It resets at 5:30 AM IST." /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask about drives, eligibility, your week..."
          placeholderTextColor={colors.subtle}
          multiline
          maxLength={2000}
          accessibilityLabel="Message to the AI assistant"
          maxFontSizeMultiplier={1.4}
          style={{
            flex: 1, minHeight: MIN_TOUCH, maxHeight: 140, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 15, lineHeight: 21,
            fontFamily: fontFamilyFor('400'), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.input,
          }}
        />
        {busy ? (
          <Pressable
            onPress={() => abortRef.current?.abort()}
            accessibilityRole="button"
            accessibilityLabel="Stop answering"
            style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }}
          >
            <Icon name="stop" size={24} color={colors.ink} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void send(input)}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
            style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? colors.primary : colors.neutralBg }}
          >
            <Icon name="send" size={22} color={canSend ? colors.surface : colors.subtle} />
          </Pressable>
        )}
      </View>
      <Text variant="caption" color={colors.muted}>AI can make mistakes. Check dates and requirements with the placement cell.</Text>
    </View>
  );

  return (
    <Page
      title="AI assistant"
      scroll={false}
      keyboard
      onBack={() => (router.canGoBack() ? router.back() : router.replace(AI_ROUTES.hub as never))}
      right={
        <View style={{ flexDirection: 'row' }}>
          <HeaderAction icon="add-comment" label="New chat" onPress={newChat} />
          <HeaderAction icon="history" label="Past conversations" onPress={() => go(AI_ROUTES.history)} />
        </View>
      }
      footer={flags.ai === true && status.data?.available ? composer : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: SCREEN_PADDING, gap: sp.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <AiGate>
          {(s) => (
            <>
              {(consentOff || generalMode) ? (
                <Banner
                  tone="info"
                  title="General answers only"
                  message="Personalisation is off, so I cannot see your profile, eligibility or applications."
                  action={{ label: 'Turn on in AI privacy', onPress: onOpenPrivacy }}
                />
              ) : null}
              {history.isLoading ? (
                <View style={{ gap: sp.md }}><Skeleton height={64} radius={14} /><Skeleton height={96} radius={14} /></View>
              ) : history.isError ? (
                <ErrorState title="Could not open this conversation" message={errMessage(history.error)} onRetry={() => void history.refetch()} />
              ) : messages.length === 0 ? (
                <View style={{ gap: sp.lg }}>
                  <Card tinted>
                    <View style={{ gap: sp.md }}>
                      <Text variant="heading">How can I help?</Text>
                      <Text variant="body" color={colors.textSecondary}>Ask about a drive, why you are or are not eligible, or how to plan your week.</Text>
                      <QuotaMeter quota={s.quota} />
                    </View>
                  </Card>
                  <Text variant="overline" color={colors.muted}>Try asking</Text>
                  {prompts.isLoading ? (
                    <View style={{ gap: sp.sm }}><Skeleton height={52} radius={12} /><Skeleton height={52} radius={12} /></View>
                  ) : prompts.isError ? (
                    <Text variant="caption" color={colors.muted}>Suggestions are unavailable right now. You can still type a question below.</Text>
                  ) : (
                    (prompts.data ?? []).map((p) => (
                      <Card key={p.id} onPress={() => void send(p.prompt, p.intent)} accessibilityLabel={p.label}>
                        <Text variant="body" style={{ fontWeight: '600' }}>{p.label}</Text>
                      </Card>
                    ))
                  )}
                </View>
              ) : (
                messages.map((m) => <Bubble key={m.key} m={m} />)
              )}
            </>
          )}
        </AiGate>
      </ScrollView>
    </Page>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === 'user';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        // a draft carries Copy / Share buttons, which a screen reader can only reach when the bubble is not one merged element
        accessible={!(m.draft && m.content)}
        accessibilityLabel={`${mine ? 'You' : 'Assistant'}: ${m.content || 'typing'}`}
        style={{
          maxWidth: '92%', gap: sp.sm, padding: sp.md, borderRadius: radius.card, borderWidth: 1,
          backgroundColor: mine ? colors.primaryTint : colors.surface, borderColor: mine ? colors.primaryTint2 : colors.border,
        }}
      >
        {m.draft ? <View style={{ flexDirection: 'row' }}><Badge label="Draft" tone="warning" /></View> : null}
        {m.streaming && !m.content ? (
          <Text variant="body" color={colors.muted}>Thinking...</Text>
        ) : (
          <Text variant="body" selectable>{m.content}</Text>
        )}
        {m.stopped ? <Text variant="caption" color={colors.muted}>Stopped</Text> : null}
        {m.draft && m.content ? <CopyShareRow text={m.content} label="Reply" /> : null}
      </View>
    </View>
  );
}
