import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { initialsOf } from "../hooks/useProfiles";
import type { AdminProfile } from "../hooks/useProfiles";

interface UserMenuProps {
  profiles: AdminProfile[];
  activeProfile: AdminProfile;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
}

// The administrator dropdown in the top-right corner of the top bar.
export default function UserMenu({
  profiles,
  activeProfile,
  onSelect,
  onOpenSettings,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openSettings = () => {
    setOpen(false);
    onOpenSettings();
  };

  return (
    <div className="topbar-user user-menu" ref={rootRef}>
      <button
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${activeProfile.name}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="avatar small-avatar">{initialsOf(activeProfile.name)}</span>
        <Icon name="chevron" size={14} className="user-chevron" />
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-head">
            <span className="avatar">{initialsOf(activeProfile.name)}</span>
            <div>
              <strong>{activeProfile.name}</strong>
              <span>{activeProfile.role}</span>
            </div>
          </div>

          {profiles.length > 1 && (
            <>
              <div className="user-menu-label">SWITCH ADMINISTRATOR</div>
              {profiles.map((profile) => {
                const active = profile.id === activeProfile.id;

                return (
                  <button
                    key={profile.id}
                    role="menuitemradio"
                    aria-checked={active}
                    className={`user-menu-item ${active ? "current" : ""}`}
                    onClick={() => {
                      onSelect(profile.id);
                      setOpen(false);
                    }}
                  >
                    <span>
                      {profile.name}
                      <small>{profile.role}</small>
                    </span>
                    {active && <span className="user-menu-tag">Active</span>}
                  </button>
                );
              })}
            </>
          )}

          <div className="user-menu-divider" />

          <button role="menuitem" className="user-menu-item" onClick={openSettings}>
            <span>Change company name</span>
          </button>
          <button role="menuitem" className="user-menu-item" onClick={openSettings}>
            <span>Manage administrators</span>
          </button>
        </div>
      )}
    </div>
  );
}
