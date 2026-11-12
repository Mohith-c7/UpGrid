import React from 'react';
import { StyleSheet, Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, fontFamilyFor, typography, type TextVariant } from '@/theme';

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  /** tabular-nums: use for any number that can change or align (prices, counts, countdowns, CGPA). */
  tabular?: boolean;
  align?: 'left' | 'center' | 'right';
}

export function Text({ variant = 'body', color, tabular, align, style, children, ...rest }: TextProps) {
  const t = typography[variant];
  const flat = StyleSheet.flatten(style) ?? {};
  // Inter ships one file per weight, so the family must follow the (possibly overridden) fontWeight
  const family = fontFamilyFor(flat.fontWeight ?? t.fontWeight);
  const isHeader = variant === 'display' || variant === 'title' || variant === 'heading';
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      accessibilityRole={isHeader ? 'header' : undefined}
      {...rest}
      style={[
        {
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          fontWeight: t.fontWeight,
          letterSpacing: t.letterSpacing,
          color: color ?? colors.ink,
        },
        t.uppercase ? { textTransform: 'uppercase' } : null,
        tabular ? TABULAR : null,
        align ? { textAlign: align } : null,
        style,
        family ? { fontFamily: family, fontWeight: undefined } : null,
      ]}
    >
      {children}
    </RNText>
  );
}
