import React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { colors, radius, spacing } from '@/theme';

interface Props {
  children: React.ReactNode;
  /** called once per caught render error (hook up crash reporting here) */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}
interface State { error: Error | null }

/**
 * Global render-error boundary. Deliberately depends only on react-native + theme tokens (no providers, no
 * router, no query client) so it can still draw when those are what crashed.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
    if (__DEV__) console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg }} accessibilityRole="alert">
        <RNText style={{ fontSize: 22, lineHeight: 28, fontWeight: '700', color: colors.ink }}>Something went wrong</RNText>
        <RNText style={{ fontSize: 15, lineHeight: 22, color: colors.textSecondary }}>
          The app hit an unexpected problem. Your data is safe. Try again, and if it keeps happening, close and reopen the app.
        </RNText>
        <Pressable
          onPress={this.reset}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={{ minHeight: 52, borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}
        >
          <RNText style={{ fontSize: 15, fontWeight: '600', color: colors.surface }}>Try again</RNText>
        </Pressable>
      </View>
    );
  }
}
