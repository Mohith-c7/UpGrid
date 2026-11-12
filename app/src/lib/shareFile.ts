import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Write text to the cache directory and open the system share sheet. Throws a user-readable Error. */
export async function shareTextFile(fileName: string, content: string, mimeType = 'text/csv', dialogTitle?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  let uri: string;
  try {
    const f = new File(Paths.cache, fileName);
    if (f.exists) f.delete();
    f.create();
    f.write(content);
    uri = f.uri;
  } catch {
    throw new Error('Could not save the file on this device. Free some storage and try again.');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI: 'public.comma-separated-values-text' });
}

/** Read a picked file (content:// or file://) as UTF-8 text. */
export async function readTextFile(uri: string): Promise<string> {
  try {
    return await new File(uri).text();
  } catch {
    throw new Error('Could not read that file. Pick a .csv file saved on this device.');
  }
}
