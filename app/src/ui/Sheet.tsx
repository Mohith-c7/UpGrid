import React, { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, CONTROL_HEIGHT, MIN_TOUCH, radius } from '@/theme';
import { Text } from './Text';
import { Icon } from './Icon';
import { useReduceMotion } from './hooks';
import { ToastInModal } from './Toast';

const DURATION = 150;

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children?: React.ReactNode }) {
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reduce) progress.setValue(1);
      else Animated.timing(progress, { toValue: 1, duration: DURATION, useNativeDriver: true }).start();
    } else if (mounted) {
      if (reduce) {
        progress.setValue(0);
        setMounted(false);
      } else {
        Animated.timing(progress, { toValue: 0, duration: DURATION, useNativeDriver: true }).start(({ finished }) => {
          if (finished) setMounted(false);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduce]);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Animated.View style={{ ...absoluteFill, backgroundColor: colors.overlay, opacity: progress }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View
            accessibilityViewIsModal
            style={{
              opacity: progress,
              maxHeight: height * 0.88,
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              paddingBottom: Math.max(insets.bottom, 12),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, minHeight: 56 }}>
              <Text variant="heading" style={{ flex: 1 }} numberOfLines={2} accessibilityRole="header">
                {title ?? ''}
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="close" size={24} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>
              {children}
            </ScrollView>
          </Animated.View>
        </View>
        <ToastInModal />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const absoluteFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

export function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value?: string | null;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', backgroundColor: colors.neutralBg, borderRadius: radius.button, padding: 3, gap: 3 }}
    >
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: sel, checked: sel }}
            style={{
              flex: 1,
              minHeight: MIN_TOUCH,
              paddingHorizontal: 8,
              borderRadius: radius.button - 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: sel ? colors.surface : 'transparent',
              borderWidth: sel ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            <Text variant="caption" color={sel ? colors.primary : colors.muted} align="center" numberOfLines={2} style={{ fontWeight: '600' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  error,
  placeholder = 'Select',
}: {
  label: string;
  value?: string | null;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string | null;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>
        {label}
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? 'not selected'}`}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingHorizontal: error ? 15 : 16,
          borderRadius: radius.input,
          borderWidth: error ? 2 : 1,
          borderColor: error ? colors.error : open ? colors.primary : colors.borderStrong,
          backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
        })}
      >
        <Text variant="body" color={current ? colors.ink : colors.subtle} numberOfLines={1} style={{ flex: 1 }}>
          {current?.label ?? placeholder}
        </Text>
        <Icon name="expand-more" size={24} color={colors.muted} />
      </Pressable>
      {error ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
          <Icon name="error-outline" size={20} color={colors.error} />
          <Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>
            {error}
          </Text>
        </View>
      ) : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        {options.map((o) => {
          const sel = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: sel }}
              accessibilityLabel={o.label}
              style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}
            >
              <Text variant="body" style={{ flex: 1, fontWeight: sel ? '600' : '400' }}>
                {o.label}
              </Text>
              {sel ? <Icon name="check" size={22} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </Sheet>
    </View>
  );
}
