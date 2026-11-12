/**
 * Cloudflare Turnstile for React Native: a WebView that renders the widget and posts the token back.
 * Only mount it when GET /config says features.turnstile is on (use `useTurnstile()` which handles that).
 *
 *   const ts = useTurnstile();
 *   ...
 *   {ts.element}                                   // renders nothing when Turnstile is off
 *   await loginRequest(email, pw, ts.token);        // token is null when off
 *   ts.reset();                                     // tokens are single use: reset after EVERY submit
 *
 * The WebView loads with `baseUrl` = EXPO_PUBLIC_TURNSTILE_BASE_URL (falls back to the API origin). That host must be
 * in the widget's hostname list in the Cloudflare dashboard (test keys ignore this).
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Banner, Button, Icon, Text } from '@/ui';
import { colors, radius } from '@/theme';
import { API_URL } from '@/api/client';
import { useFeatures } from '@/config/features';

export interface TurnstileHandle { reset: () => void }
type WidgetState = 'loading' | 'ready' | 'verified' | 'expired' | 'error';

const HEIGHT = 72;

function baseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_TURNSTILE_BASE_URL;
  if (fromEnv && /^https:\/\//i.test(fromEnv)) return fromEnv.replace(/\/+$/, '') + '/';
  try {
    const u = new URL(API_URL);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return 'https://localhost/';
  }
}

function buildHtml(siteKey: string): string {
  const key = JSON.stringify(siteKey).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:#ffffff;overflow:hidden}#w{width:100%}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTsLoad&render=explicit" async defer></script>
</head><body><div id="w"></div><script>
function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}
function onTsLoad(){
  try{
    post({t:'ready'});
    turnstile.render('#w',{sitekey:${key},theme:'light',size:'flexible',retry:'auto',
      callback:function(tok){post({t:'token',v:tok})},
      'error-callback':function(c){post({t:'error',v:String(c)});return true},
      'expired-callback':function(){post({t:'expired'})},
      'timeout-callback':function(){post({t:'expired'})}});
  }catch(e){post({t:'error',v:String(e)})}
}
</script></body></html>`;
}

export const TurnstileWidget = forwardRef<
  TurnstileHandle,
  {
    siteKey: string;
    onToken: (token: string) => void;
    onExpire?: () => void;
    onStateChange?: (s: WidgetState) => void;
  }
>(function TurnstileWidget({ siteKey, onToken, onExpire, onStateChange }, ref) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<WidgetState>('loading');
  const html = useMemo(() => buildHtml(siteKey), [siteKey]);
  const base = useMemo(baseUrl, []);
  const stuckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(
    (s: WidgetState) => {
      setState(s);
      onStateChange?.(s);
    },
    [onStateChange],
  );

  const restart = useCallback(() => {
    update('loading');
    setNonce((n) => n + 1);
  }, [update]);

  useImperativeHandle(ref, () => ({ reset: restart }), [restart]);

  // a widget that never answers (blocked network) must not leave the user waiting silently
  useEffect(() => {
    if (state !== 'loading') return;
    stuckTimer.current = setTimeout(() => update('error'), 25000);
    return () => {
      if (stuckTimer.current) clearTimeout(stuckTimer.current);
    };
  }, [state, nonce, update]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { t?: string; v?: string } = {};
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.t === 'token' && m.v) {
      update('verified');
      onToken(m.v);
    } else if (m.t === 'ready') update('ready');
    else if (m.t === 'expired') {
      update('expired');
      onExpire?.();
    } else if (m.t === 'error') update('error');
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ height: HEIGHT, borderRadius: radius.input, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface }}>
        {state === 'error' ? (
          <View style={{ flex: 1, padding: 8, justifyContent: 'center' }}>
            <Text variant="caption" color={colors.error}>Security check could not load.</Text>
          </View>
        ) : (
          <WebView
            key={nonce}
            originWhitelist={['https://*', 'about:blank']}
            source={{ html, baseUrl: base }}
            onMessage={onMessage}
            onError={() => update('error')}
            onHttpError={() => update('error')}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            style={{ backgroundColor: 'transparent' }}
            onShouldStartLoadWithRequest={(req) => {
              if ((req as { isTopFrame?: boolean }).isTopFrame === false) return true;
              return req.url === 'about:blank' || req.url.startsWith(base) || /^https:\/\/([a-z0-9-]+\.)*cloudflare\.com(\/|$)/i.test(req.url);
            }}
            accessibilityLabel="Security check"
          />
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} accessibilityLiveRegion="polite">
        {state === 'verified' ? (
          <>
            <Icon name="check-circle" size={20} color={colors.success} />
            <Text variant="caption" color={colors.success} style={{ fontWeight: '600' }}>Security check passed</Text>
          </>
        ) : state === 'error' ? (
          <>
            <Icon name="error-outline" size={20} color={colors.error} />
            <Text variant="caption" color={colors.error} style={{ flex: 1 }}>Check your connection, then try again.</Text>
            <Button label="Retry check" size="sm" variant="secondary" onPress={restart} />
          </>
        ) : state === 'expired' ? (
          <>
            <Icon name="timer-off" size={20} color={colors.warning} />
            <Text variant="caption" color={colors.warning} style={{ flex: 1 }}>The check expired. It will refresh.</Text>
            <Button label="Refresh" size="sm" variant="secondary" onPress={restart} />
          </>
        ) : (
          <>
            <Icon name="shield" size={20} color={colors.muted} />
            <Text variant="caption" color={colors.muted}>Complete the security check above.</Text>
          </>
        )}
      </View>
    </View>
  );
});

export interface UseTurnstile {
  /** true when the server enforces Turnstile */
  required: boolean;
  /** current single-use token, or null (always null when not required) */
  token: string | null;
  /** true when no token is needed or one is available */
  ready: boolean;
  /** render this in the form; null when Turnstile is off */
  element: React.ReactNode;
  /** discard the token and re-run the challenge. Call after every submit (success or failure). */
  reset: () => void;
  /** message to show when the user submits before the check is done */
  notReadyMessage: string;
}

export function useTurnstile(): UseTurnstile {
  const { flags, config, status } = useFeatures();
  const required = flags.turnstile === true;
  const siteKey = config.turnstileSiteKey;
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<TurnstileHandle>(null);

  const reset = useCallback(() => {
    setToken(null);
    ref.current?.reset();
  }, []);

  const element = useMemo(() => {
    if (!required) return null;
    if (!siteKey) {
      return <Banner tone="error" message="The security check is not available right now. Please try again later." />;
    }
    return <TurnstileWidget ref={ref} siteKey={siteKey} onToken={setToken} onExpire={() => setToken(null)} />;
  }, [required, siteKey]);

  return {
    required,
    token: required ? token : null,
    ready: !required || token !== null,
    element,
    reset,
    notReadyMessage: status === 'loading' ? 'Still connecting. Please try again in a moment.' : 'Complete the security check first.',
  };
}
