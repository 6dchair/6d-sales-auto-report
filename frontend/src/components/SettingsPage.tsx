import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { initialsOf } from "../hooks/useProfiles";
import type { AdminProfile } from "../hooks/useProfiles";
import CategoriesPanel from "./CategoriesPanel";
import "./SettingsPage.css";

interface SettingsPageProps {
  systemName: string;
  onSystemNameChange: (name: string) => void;
  profiles: AdminProfile[];
  activeId: string;
  onAdd: (name: string, role: string) => void;
  onUpdate: (id: string, changes: { name: string; role: string }) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}

const MAX_LENGTH = 40;
const MAX_SYSTEM_NAME = 30;
const DEFAULT_ROLE = "Administrator";

// Returns an error message, or "" when the values are fine.
function validate(
  name: string,
  role: string,
  profiles: AdminProfile[],
  ignoreId?: string
): string {
  if (!name) return "Enter a name.";
  if (name.length > MAX_LENGTH) return `Name must be ${MAX_LENGTH} characters or fewer.`;
  if (role.length > MAX_LENGTH) return `Role must be ${MAX_LENGTH} characters or fewer.`;

  const taken = profiles.some(
    (profile) =>
      profile.id !== ignoreId &&
      profile.name.toLowerCase() === name.toLowerCase()
  );
  return taken ? "An administrator with this name already exists." : "";
}

export default function SettingsPage({
  systemName,
  onSystemNameChange,
  profiles,
  activeId,
  onAdd,
  onUpdate,
  onRemove,
  onSelect,
}: SettingsPageProps) {
  // --- system name ---
  const [editingSystem, setEditingSystem] = useState(false);
  const [systemDraft, setSystemDraft] = useState(systemName);
  const [systemError, setSystemError] = useState("");

  // --- add administrator ---
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [addError, setAddError] = useState("");

  // --- edit / remove administrator ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editError, setEditError] = useState("");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const onEscape =
    (cancel: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") cancel();
    };

  // ----- system name -----
  const startSystemEdit = () => {
    setSystemDraft(systemName);
    setSystemError("");
    setEditingSystem(true);
  };

  const cancelSystemEdit = () => {
    setEditingSystem(false);
    setSystemError("");
  };

  const saveSystemName = (event: FormEvent) => {
    event.preventDefault();

    const clean = systemDraft.trim();
    if (!clean) {
      setSystemError("Enter a company name.");
      return;
    }
    if (clean.length > MAX_SYSTEM_NAME) {
      setSystemError(`Company name must be ${MAX_SYSTEM_NAME} characters or fewer.`);
      return;
    }

    onSystemNameChange(clean);
    cancelSystemEdit();
  };

  // ----- add administrator -----
  const resetAdd = () => {
    setName("");
    setRole("");
    setAddError("");
  };

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanRole = role.trim() || DEFAULT_ROLE;
    const error = validate(cleanName, cleanRole, profiles);

    if (error) {
      setAddError(error);
      return;
    }

    onAdd(cleanName, cleanRole);
    resetAdd();
  };

  // ----- edit administrator -----
  const startEdit = (profile: AdminProfile) => {
    setConfirmRemoveId(null);
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditRole(profile.role);
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError("");
  };

  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingId) return;

    const cleanName = editName.trim();
    const cleanRole = editRole.trim() || DEFAULT_ROLE;
    const error = validate(cleanName, cleanRole, profiles, editingId);

    if (error) {
      setEditError(error);
      return;
    }

    onUpdate(editingId, { name: cleanName, role: cleanRole });
    cancelEdit();
  };

  return (
    <div className="dashboard-page settings-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">PREFERENCES</div>
          <h1>Settings</h1>
          <p className="page-subtitle">
            Set your company name and manage the administrator profiles.
          </p>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Company name (system name)</h2>
            <p>
              Replace “6dMetrix” with your own company name. It appears in the
              sidebar, browser tab, page footer and PDF reports.
            </p>
          </div>
        </div>

        {editingSystem ? (
          <form className="settings-form system-name-form" onSubmit={saveSystemName}>
            <label className="field">
              <span>Company name</span>
              <input
                className="text-input"
                value={systemDraft}
                autoFocus
                onChange={(event) => setSystemDraft(event.target.value)}
                onKeyDown={onEscape(cancelSystemEdit)}
              />
            </label>

            <div className="form-actions">
              <button type="submit" className="button-primary">
                Save
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={cancelSystemEdit}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="system-name-row">
            <strong>{systemName}</strong>
            <button
              type="button"
              className="button-secondary compact-button"
              onClick={startSystemEdit}
            >
              Change
            </button>
          </div>
        )}

        {systemError && <div className="api-error settings-error">{systemError}</div>}
      </section>

      <CategoriesPanel />

      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Administrators</h2>
            <p>The active administrator is shown in the sidebar and top bar.</p>
          </div>
        </div>

        <form className="settings-table-form" onSubmit={saveEdit}>
          <div className="table-scroll settings-table-wrap">
            <table className="transactions-table settings-table">
              <thead>
                <tr>
                  <th>ADMINISTRATOR</th>
                  <th>ROLE</th>
                  <th>STATUS</th>
                  <th className="settings-actions-head">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  const editing = editingId === profile.id;
                  const active = profile.id === activeId;

                  return (
                    <tr key={profile.id}>
                      <td>
                        {editing ? (
                          <input
                            className="text-input"
                            value={editName}
                            maxLength={MAX_LENGTH + 10}
                            aria-label="Name"
                            autoFocus
                            onChange={(event) => setEditName(event.target.value)}
                            onKeyDown={onEscape(cancelEdit)}
                          />
                        ) : (
                          <div className="settings-name">
                            <span className="avatar small-avatar">
                              {initialsOf(profile.name)}
                            </span>
                            <strong>{profile.name}</strong>
                          </div>
                        )}
                      </td>

                      <td>
                        {editing ? (
                          <input
                            className="text-input"
                            value={editRole}
                            maxLength={MAX_LENGTH + 10}
                            aria-label="Role"
                            onChange={(event) => setEditRole(event.target.value)}
                            onKeyDown={onEscape(cancelEdit)}
                          />
                        ) : (
                          profile.role
                        )}
                      </td>

                      <td>
                        {active ? (
                          <span className="status-pill">Active</span>
                        ) : (
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => onSelect(profile.id)}
                          >
                            Make active
                          </button>
                        )}
                      </td>

                      <td>
                        <div className="row-actions">
                          {editing ? (
                            <>
                              <button
                                type="submit"
                                className="button-primary compact-button"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="button-secondary compact-button"
                                onClick={cancelEdit}
                              >
                                Cancel
                              </button>
                            </>
                          ) : confirmRemoveId === profile.id ? (
                            <>
                              <span className="confirm-text">Remove?</span>
                              <button
                                type="button"
                                className="text-link danger-link"
                                onClick={() => {
                                  onRemove(profile.id);
                                  setConfirmRemoveId(null);
                                }}
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                className="text-link muted-link"
                                onClick={() => setConfirmRemoveId(null)}
                              >
                                No
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="text-link"
                                onClick={() => startEdit(profile)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-link danger-link"
                                disabled={profiles.length <= 1}
                                title={
                                  profiles.length <= 1
                                    ? "At least one administrator is required"
                                    : undefined
                                }
                                onClick={() => setConfirmRemoveId(profile.id)}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>

        {editError && <div className="api-error settings-error">{editError}</div>}
      </section>

      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Add administrator</h2>
            <p>Role is optional and defaults to "{DEFAULT_ROLE}".</p>
          </div>
        </div>

        <form className="settings-form" onSubmit={handleAdd}>
          <label className="field">
            <span>Name</span>
            <input
              className="text-input"
              value={name}
              placeholder="e.g. Kurt Cobain"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={onEscape(resetAdd)}
            />
          </label>

          <label className="field">
            <span>Role</span>
            <input
              className="text-input"
              value={role}
              placeholder="e.g. Sales supervisor"
              onChange={(event) => setRole(event.target.value)}
              onKeyDown={onEscape(resetAdd)}
            />
          </label>

          <div className="form-actions">
            <button type="submit" className="button-primary">
              Add administrator
            </button>
            <button type="button" className="button-secondary" onClick={resetAdd}>
              Cancel
            </button>
          </div>
        </form>

        {addError && <div className="api-error settings-error">{addError}</div>}

        <p className="settings-note">
          Profiles and the system name are saved in this browser only and are
          used for display. They do not control who can sign in.
        </p>
      </section>
    </div>
  );
}