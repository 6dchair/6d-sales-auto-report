import { useCallback, useEffect, useState } from "react";

export const DEFAULT_SYSTEM_NAME = "6dMetrix";
const STORAGE_KEY = "6dmetrix.systemName";

function load(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // Storage unavailable: use the default.
  }
  return DEFAULT_SYSTEM_NAME;
}

/** The system name shown in the sidebar, page title, footer and report PDFs. */
export function useSystemName() {
  const [systemName, setSystemNameState] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, systemName);
    } catch {
      // Ignore storage errors.
    }
    document.title = systemName;
  }, [systemName]);

  const setSystemName = useCallback((name: string) => {
    setSystemNameState(name.trim() || DEFAULT_SYSTEM_NAME);
  }, []);

  return { systemName, setSystemName };
}
