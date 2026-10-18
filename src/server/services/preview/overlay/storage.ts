/**
 * Akses Web Storage yang tidak pernah melempar (storage bisa diblokir di
 * mode privat / iframe pihak ketiga) — semuanya fitur kenyamanan saja.
 */

function area(get: () => Storage): Storage | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

export const local = area(() => window.localStorage);
export const sessionArea = area(() => window.sessionStorage);

export const store = {
  get(target: Storage | undefined, key: string): string | null {
    try {
      return target?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(target: Storage | undefined, key: string, value: string): void {
    try {
      target?.setItem(key, value);
    } catch {
      // storage diblokir — fitur kenyamanan saja
    }
  },
};
