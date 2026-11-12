import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { startUpload } from '@/features/uploads';
import { addFileResume } from '@/api/integrations';
import type { UploadLimits } from '@/api/integrationsTypes';

/** Render HTML to a PDF in the app cache with a readable file name. Returns its uri. */
export async function makePdf(html: string, fileName: string): Promise<string> {
  let tmp: string;
  try {
    ({ uri: tmp } = await Print.printToFileAsync({ html, width: 595, height: 842 }));
  } catch {
    throw new Error('Could not create the PDF on this device. Free some storage and try again.');
  }
  try {
    const dest = new File(Paths.cache, fileName);
    if (dest.exists) dest.delete();
    new File(tmp).move(dest);
    return dest.uri;
  } catch {
    return tmp; // the generated name still works; only the file name is less friendly
  }
}

export async function sharePdf(uri: string, title = 'Share resume'): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
}

/** Upload the PDF to R2 and attach it as a resume entry. Throws UploadError / ApiError (RESUME_LIMIT etc). */
export async function savePdfAsResume(opts: { uri: string; fileName: string; label: string; limits: UploadLimits; isDefault?: boolean }) {
  const h = startUpload({ purpose: 'resume', file: { uri: opts.uri, name: opts.fileName, mimeType: 'application/pdf' }, limits: opts.limits });
  const file = await h.promise;
  return addFileResume({ label: opts.label, fileId: file.id, ...(opts.isDefault ? { isDefault: true } : {}) });
}
