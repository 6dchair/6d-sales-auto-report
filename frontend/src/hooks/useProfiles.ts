import { useCallback, useEffect, useState } from "react";

export interface AdminProfile {
  id: string;
  name: string;
  role: string;
}

interface StoredProfiles {
  profiles: AdminProfile[];
  activeId: string;
}

const STORAGE_KEY = "6dmetrix.profiles";

const DEFAULT_STATE: StoredProfiles = {
  profiles: [{ id: "admin-1", name: "Administrator", role: "Store manager" }],
  activeId: "admin-1",
};

const isProfile = (value: unknown): value is AdminProfile => {
  const item = value as AdminProfile;
  return (
    !!item &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.role === "string"
  );
};

function loadState(): StoredProfiles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;

    const data = JSON.parse(raw);
    if (
      Array.isArray(data.profiles) &&
      data.profiles.length > 0 &&
      data.profiles.every(isProfile)
    ) {
      const activeId = data.profiles.some(
        (profile: AdminProfile) => profile.id === data.activeId
      )
        ? data.activeId
        : data.profiles[0].id;

      return { profiles: data.profiles, activeId };
    }
  } catch {
    // Fall back to the default profile if storage is unavailable or corrupt.
  }

  return DEFAULT_STATE;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// "Maria Santos" -> "MS", "Administrator" -> "AD"
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Administrator profiles shown in the sidebar and top bar.
 * They are saved in this browser only and are for display; they do not
 * control who can sign in.
 */
export function useProfiles() {
  const [state, setState] = useState<StoredProfiles>(loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors (private mode, quota).
    }
  }, [state]);

  const activeProfile =
    state.profiles.find((profile) => profile.id === state.activeId) ??
    state.profiles[0];

  const addProfile = useCallback((name: string, role: string) => {
    setState((current) => ({
      ...current,
      profiles: [...current.profiles, { id: newId(), name, role }],
    }));
  }, []);

  const updateProfile = useCallback(
    (id: string, changes: { name: string; role: string }) => {
      setState((current) => ({
        ...current,
        profiles: current.profiles.map((profile) =>
          profile.id === id ? { ...profile, ...changes } : profile
        ),
      }));
    },
    []
  );

  const removeProfile = useCallback((id: string) => {
    setState((current) => {
      if (current.profiles.length <= 1) return current;

      const profiles = current.profiles.filter((profile) => profile.id !== id);
      const activeId =
        current.activeId === id ? profiles[0].id : current.activeId;

      return { profiles, activeId };
    });
  }, []);

  const selectProfile = useCallback((id: string) => {
    setState((current) =>
      current.profiles.some((profile) => profile.id === id)
        ? { ...current, activeId: id }
        : current
    );
  }, []);

  return {
    profiles: state.profiles,
    activeProfile,
    addProfile,
    updateProfile,
    removeProfile,
    selectProfile,
  };
}
