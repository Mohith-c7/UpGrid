import { useCallback } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '@/ui';

/**
 * Copy text to the system clipboard. Falls back to the share sheet if the clipboard is unavailable.
 * Resolves true when the text was copied, false when it fell back to the share sheet (or the user dismissed it).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    try {
      await Share.share({ message: text });
    } catch {
      /* dismissed */
    }
    return false;
  }
}

/** `const copy = useCopy(); copy(link, 'Link')` copies and toasts "Link copied". */
export function useCopy(): (text: string, label?: string) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (text: string, label = 'Copied') => {
      const ok = await copyText(text);
      if (ok) toast.show(label === 'Copied' ? 'Copied to clipboard' : `${label} copied`, 'success');
    },
    [toast],
  );
}
