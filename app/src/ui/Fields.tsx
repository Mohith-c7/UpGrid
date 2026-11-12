import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';
import { colors, CONTROL_HEIGHT, fontFamilyFor, MIN_TOUCH, radius } from '@/theme';
import { PHONE_ERROR, passwordStrength, suggestEmailFix, validateEmail, validatePhone } from '@/lib/validation';
import { Text } from './Text';
import { Icon } from './Icon';

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  helper?: string;
  keyboardType?: KeyboardTypeOptions;
  secure?: boolean;
  multiline?: boolean;
  maxLength?: number;
  prefix?: string;
  suffix?: React.ReactNode;
  onBlur?: () => void;
  placeholder?: string;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  editable?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  helper,
  keyboardType,
  secure,
  multiline,
  maxLength,
  prefix,
  suffix,
  onBlur,
  placeholder,
  autoCapitalize,
  autoComplete,
  textContentType,
  editable = true,
  returnKeyType,
  onSubmitEditing,
  inputRef,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const hasError = !!error;
  const bw = focused || hasError ? 2 : 1; // focus ring / error ring is 2px; content is compensated so nothing shifts
  const borderColor = hasError ? colors.error : focused ? colors.primary : colors.borderStrong;
  const fieldHeight = multiline ? 112 : CONTROL_HEIGHT;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'stretch',
          minHeight: fieldHeight,
          borderWidth: bw,
          borderColor,
          borderRadius: radius.input,
          backgroundColor: editable ? colors.surface : colors.neutralBg,
          overflow: 'hidden',
        }}
      >
        {prefix ? (
          <View
            style={{
              paddingHorizontal: 14 - bw + 1,
              justifyContent: multiline ? 'flex-start' : 'center',
              backgroundColor: colors.pressed,
              borderRightWidth: 1,
              borderRightColor: colors.border,
              paddingTop: multiline ? 14 : 0,
            }}
          >
            <Text variant="body" color={colors.textSecondary} tabular style={{ fontWeight: '600' }}>
              {prefix}
            </Text>
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={label}
          accessibilityHint={error ?? helper}
          placeholder={placeholder}
          placeholderTextColor={colors.subtle}
          selectionColor={colors.primary}
          keyboardType={keyboardType}
          secureTextEntry={secure}
          multiline={multiline}
          maxLength={maxLength}
          editable={editable}
          autoCapitalize={autoCapitalize ?? (secure || keyboardType === 'email-address' ? 'none' : 'sentences')}
          autoCorrect={secure || keyboardType === 'email-address' ? false : undefined}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          maxFontSizeMultiplier={1.6}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={{
            flex: 1,
            fontSize: 15,
            lineHeight: 20,
            fontFamily: fontFamilyFor('400'),
            color: editable ? colors.ink : colors.muted,
            paddingHorizontal: 16 - bw,
            paddingVertical: multiline ? 14 : 8,
            minHeight: multiline ? 108 : CONTROL_HEIGHT - 2 * bw,
          }}
        />
        {suffix}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
          <Icon name="error-outline" size={20} color={colors.error} />
          <Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>
            {error}
          </Text>
        </View>
      ) : helper || (maxLength && multiline) ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="caption" color={colors.muted} style={{ flex: 1 }}>
            {helper ?? ''}
          </Text>
          {maxLength && multiline ? (
            <Text variant="caption" color={colors.muted} tabular>
              {value.length}/{maxLength}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ---------- Phone ---------- */
export function PhoneField({
  label = 'Mobile number',
  value,
  onChangeText,
  error,
  onBlur,
  onValidChange,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  onBlur?: () => void;
  onValidChange?: (ten: string | null) => void;
}) {
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!onValidChange) return;
    const r = validatePhone(value);
    onValidChange(r.ok ? r.value : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (t: string) => {
    let d = t.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    onChangeText(d.slice(0, 10));
  };

  let live: string | null = null;
  if (value.length > 0) {
    if (!/^[6-9]/.test(value)) live = PHONE_ERROR;
    else if (value.length === 10) {
      const r = validatePhone(value);
      if (!r.ok) live = r.error;
    } else if (touched) live = PHONE_ERROR;
  } else if (touched) live = 'Enter your mobile number';

  return (
    <TextField
      label={label}
      value={value}
      onChangeText={handle}
      keyboardType="number-pad"
      prefix="+91"
      maxLength={20}
      placeholder="98765 43210"
      autoComplete="tel"
      textContentType="telephoneNumber"
      error={error ?? live}
      helper="10-digit mobile number"
      onBlur={() => {
        setTouched(true);
        onBlur?.();
      }}
    />
  );
}

/* ---------- Email ---------- */
export function EmailField({
  label = 'Email',
  value,
  onChangeText,
  error,
  onBlur,
  validate = true,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  onBlur?: () => void;
  validate?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const fix = validate ? suggestEmailFix(value) : null;
  let live: string | null = null;
  if (validate && value.trim().length > 0) {
    const r = validateEmail(value);
    const looksComplete = /@.+\..+/.test(value);
    if (!r.ok && (touched || fix || looksComplete)) live = r.error;
  } else if (validate && touched) live = 'Enter your email address';

  return (
    <View style={{ gap: 6 }}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        placeholder="name@example.com"
        error={error ?? live}
        onBlur={() => {
          setTouched(true);
          onBlur?.();
        }}
      />
      {fix ? (
        <Pressable
          onPress={() => onChangeText(fix)}
          accessibilityRole="button"
          accessibilityLabel={`Use ${fix}`}
          style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
        >
          <Text variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>
            Did you mean {fix}? Tap to use it
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------- Password ---------- */
const STRENGTH_COLORS = [colors.border, colors.error, colors.warning, colors.info, colors.success];

export function PasswordField({
  label = 'Password',
  value,
  onChangeText,
  error,
  showStrength,
  onBlur,
  placeholder,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  showStrength?: boolean;
  onBlur?: () => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const s = passwordStrength(value);
  return (
    <View style={{ gap: 8 }}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        secure={!visible}
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        placeholder={placeholder}
        error={error}
        onBlur={onBlur}
        suffix={
          <Pressable
            onPress={() => setVisible((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            style={{ width: MIN_TOUCH, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={visible ? 'visibility-off' : 'visibility'} size={22} color={colors.subtle} />
          </Pressable>
        }
      />
      {showStrength && value.length > 0 ? (
        <View accessible accessibilityLabel={`Password strength: ${s.label}`} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= s.score ? STRENGTH_COLORS[s.score] : colors.border }} />
            ))}
          </View>
          <Text variant="caption" color={colors.muted}>
            {s.label}. Use 8 or more characters with letters and numbers.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
