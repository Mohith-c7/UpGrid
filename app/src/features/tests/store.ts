/** Tiny best-effort JSON persistence in the app document directory (survives app kill). Never throws. */
import { File, Paths } from 'expo-file-system';

const file = (name: string) => new File(Paths.document, `placementos-${name}.json`);

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const f = file(name);
    if (!f.exists) return null;
    return JSON.parse(await f.text()) as T;
  } catch {
    return null;
  }
}

export function writeJson(name: string, value: unknown): void {
  try {
    const f = file(name);
    if (!f.exists) f.create();
    f.write(JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the server copy still exists */
  }
}

export function removeJson(name: string): void {
  try {
    const f = file(name);
    if (f.exists) f.delete();
  } catch {
    /* ignore */
  }
}
