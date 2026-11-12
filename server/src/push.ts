export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  channelId?: string;
}
export interface PushResult { invalidTokens: string[] }
export type PushSender = (messages: PushMessage[]) => Promise<PushResult>;

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo push sender with an injectable fetch (tests never hit the network). Never throws. */
export function createExpoPushSender(
  fetchImpl: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined,
  url = EXPO_PUSH_URL,
  log: (m: string) => void = (m) => console.error(m),
): PushSender {
  return async (messages) => {
    const invalid: string[] = [];
    if (!fetchImpl || messages.length === 0) return { invalidTokens: invalid };
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          log(`[push] expo responded ${res.status}`);
          continue;
        }
        const json: any = await res.json();
        const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
        tickets.forEach((t, idx) => {
          if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') invalid.push(chunk[idx].to);
        });
      } catch (e) {
        log(`[push] send failed: ${(e as Error).message}`);
      }
    }
    return { invalidTokens: invalid };
  };
}

export const noopPushSender: PushSender = async () => ({ invalidTokens: [] });
