import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/theme';
import { Text } from './Text';
import { Icon } from './Icon';
import { useReduceMotion } from './hooks';

export type ToastTone = 'success' | 'error' | 'info';
export interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const NOOP: ToastApi = { show: () => undefined };
const ToastContext = createContext<ToastApi>(NOOP);

type ToastView = { toast: { id: number; message: string; tone: ToastTone } | null; opacity: Animated.Value; bottom: number; setSheets: (fn: (n: number) => number) => void };
const ToastViewContext = createContext<ToastView | null>(null);

function ToastBubble({ view }: { view: ToastView }) {
  const { toast, opacity, bottom } = view;
  if (!toast) return null;
  const bg = toast.tone === 'error' ? colors.error : toast.tone === 'success' ? colors.success : colors.ink;
  const icon = toast.tone === 'error' ? 'error-outline' : toast.tone === 'success' ? 'check-circle-outline' : 'info-outline';
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 16, right: 16, bottom, opacity }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: bg, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Icon name={icon} size={20} color={colors.onPrimary} />
        <Text variant="body" color={colors.onPrimary} style={{ flex: 1 }}>{toast.message}</Text>
      </View>
    </Animated.View>
  );
}

/** Render inside a Modal (Sheet): toasts live in the app window and would otherwise be hidden behind it. */
export function ToastInModal() {
  const view = useContext(ToastViewContext);
  const setSheets = view?.setSheets;
  useEffect(() => {
    setSheets?.((n) => n + 1);
    return () => setSheets?.((n) => Math.max(0, n - 1));
  }, [setSheets]);
  return view ? <ToastBubble view={{ ...view, bottom: 24 }} /> : null;
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children?: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);
  const [sheets, setSheets] = useState(0);
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();

  const hide = useCallback(() => {
    if (reduce) {
      opacity.setValue(0);
      setToast(null);
      return;
    }
    Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [opacity, reduce]);

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      counter.current += 1;
      setToast({ id: counter.current, message, tone });
      AccessibilityInfo.announceForAccessibility(message);
      if (reduce) opacity.setValue(1);
      else Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, tone === 'error' ? 5000 : 3000);
    },
    [hide, opacity, reduce],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo<ToastApi>(() => ({ show }), [show]);
  const view = useMemo<ToastView>(() => ({ toast, opacity, bottom: Math.max(insets.bottom, 12) + 72, setSheets }), [toast, opacity, insets.bottom]);

  return (
    <ToastContext.Provider value={api}>
      <ToastViewContext.Provider value={view}>
        {children}
        {sheets === 0 ? <ToastBubble view={view} /> : null}
      </ToastViewContext.Provider>
    </ToastContext.Provider>
  );
}
