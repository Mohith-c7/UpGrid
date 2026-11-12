/** Plain monospace editor: TextInput multiline plus Tab / outdent / bracket helper buttons. No native editor dependency. */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Icon, Text } from '@/ui';
import { colors, MIN_TOUCH, monoFamily, radius } from '@/theme';

export const MAX_CODE = 32000;
const INDENT = '    ';
const SYMBOLS = ['{', '}', '(', ')', '[', ']', ';', ':', '"', "'", '=', '<', '>', '/', '_', '#', '+', '-', '*'];

interface Sel { start: number; end: number }

/** Indent or outdent every line touched by [start,end]. Returns new text and selection. */
export function shiftLines(text: string, sel: Sel, dir: 1 | -1): { text: string; sel: Sel } {
  const from = text.lastIndexOf('\n', Math.max(0, sel.start) - 1) + 1;
  let toIdx = text.indexOf('\n', sel.end > sel.start && text[sel.end - 1] === '\n' ? sel.end - 1 : sel.end);
  if (toIdx === -1) toIdx = text.length;
  const block = text.slice(from, toIdx).split('\n');
  let firstDelta = 0;
  let total = 0;
  const next = block.map((ln, i) => {
    let out: string;
    if (dir === 1) out = ln.length ? INDENT + ln : ln;
    else if (ln.startsWith(INDENT)) out = ln.slice(INDENT.length);
    else if (ln.startsWith('\t')) out = ln.slice(1);
    else out = ln.replace(/^ {1,3}/, '');
    const d = out.length - ln.length;
    if (i === 0) firstDelta = d;
    total += d;
    return out;
  });
  return {
    text: text.slice(0, from) + next.join('\n') + text.slice(toIdx),
    sel: { start: Math.max(from, sel.start + firstDelta), end: Math.max(from, sel.end + total) },
  };
}

function HelperKey({ label, onPress, wide, a11y, icon }: { label?: string; onPress: () => void; wide?: boolean; a11y: string; icon?: React.ComponentProps<typeof Icon>['name'] }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => ({
        minWidth: wide ? 64 : MIN_TOUCH, minHeight: MIN_TOUCH, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4,
        borderRadius: radius.chip, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: pressed ? colors.pressed : colors.surface,
      })}
    >
      {icon ? <Icon name={icon} size={20} color={colors.ink} /> : null}
      {label ? <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: monoFamily, fontSize: 15, color: colors.ink }}>{label}</Text> : null}
    </Pressable>
  );
}

export function CodeEditor({
  value, onChange, readOnly, minHeight = 280,
}: { value: string; onChange: (t: string) => void; readOnly?: boolean; minHeight?: number }) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const selRef = useRef<Sel>({ start: value.length, end: value.length });
  const [forced, setForced] = useState<Sel | undefined>();

  const apply = useCallback((next: string, sel: Sel) => {
    selRef.current = sel;
    onChange(next);
    setForced(sel);
  }, [onChange]);

  const insert = (s: string) => {
    const t = valueRef.current;
    const { start, end } = selRef.current;
    if (t.length - (end - start) + s.length > MAX_CODE) return;
    apply(t.slice(0, start) + s + t.slice(end), { start: start + s.length, end: start + s.length });
  };
  const indent = () => {
    const { start, end } = selRef.current;
    if (start === end) insert(INDENT);
    else {
      const r = shiftLines(valueRef.current, selRef.current, 1);
      if (r.text.length <= MAX_CODE) apply(r.text, r.sel);
    }
  };
  const outdent = () => {
    const r = shiftLines(valueRef.current, selRef.current, -1);
    apply(r.text, r.sel);
  };

  const onText = (t: string) => {
    const old = valueRef.current;
    const pos = selRef.current.start;
    // Keep the previous line's indent after Enter (and add one level after : { ( [).
    if (selRef.current.start === selRef.current.end && t.length === old.length + 1 && t[pos] === '\n' && t.slice(0, pos) === old.slice(0, pos)) {
      const lineStart = old.lastIndexOf('\n', pos - 1) + 1;
      const line = old.slice(lineStart, pos);
      const base = /^[ \t]*/.exec(line)?.[0] ?? '';
      const extra = /[:{(\[]\s*$/.test(line) ? INDENT : '';
      if ((base || extra) && old.length + 1 + base.length + extra.length <= MAX_CODE) {
        const ins = `\n${base}${extra}`;
        apply(old.slice(0, pos) + ins + old.slice(pos), { start: pos + ins.length, end: pos + ins.length });
        return;
      }
    }
    onChange(t);
  };

  const lines = value.length ? value.split('\n').length : 1;
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.input, backgroundColor: readOnly ? colors.pressed : colors.surface, overflow: 'hidden',
        }}
      >
        <TextInput
          value={value}
          onChangeText={onText}
          onSelectionChange={(e) => {
            selRef.current = e.nativeEvent.selection;
            if (forced) setForced(undefined);
          }}
          selection={forced}
          multiline
          scrollEnabled={false}
          editable={!readOnly}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
          maxLength={MAX_CODE}
          textAlignVertical="top"
          placeholder="Write your code here"
          placeholderTextColor={colors.subtle}
          accessibilityLabel="Code editor"
          maxFontSizeMultiplier={1.4}
          style={{ minHeight, padding: 12, fontFamily: monoFamily, fontSize: 14, lineHeight: 21, color: colors.ink }}
        />
      </View>
      {!readOnly ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }} accessibilityLabel="Code helper keys">
          <HelperKey a11y="Indent" icon="format-indent-increase" label="Tab" wide onPress={indent} />
          <HelperKey a11y="Outdent" icon="format-indent-decrease" onPress={outdent} />
          {SYMBOLS.map((s) => (
            <HelperKey key={s} label={s} a11y={`Insert ${s}`} onPress={() => insert(s)} />
          ))}
        </ScrollView>
      ) : null}
      <Text variant="caption" tabular color={colors.muted}>{`${lines} ${lines === 1 ? 'line' : 'lines'}, ${value.length} of ${MAX_CODE} characters`}</Text>
    </View>
  );
}
