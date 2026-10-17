import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../services/api";
import type { Category } from "../types";

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

// Add, rename and delete product categories (shown on the Settings page).
export default function CategoriesPanel() {
  const [items, setItems] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    api
      .getCategories()
      .then(setItems)
      .catch((err) => setError(messageOf(err, "Could not load categories.")));

  useEffect(() => {
    void load();
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(messageOf(err, "Something went wrong."));
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a category name.");
      return;
    }
    void run(async () => {
      await api.createCategory(name.trim());
      setName("");
    });
  };

  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (editingId === null || !editName.trim()) {
      setError("Enter a category name.");
      return;
    }
    void run(async () => {
      await api.renameCategory(editingId, editName.trim());
      setEditingId(null);
    });
  };

  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <h2>Product categories</h2>
          <p>
            Group your products any way you like. Renaming a category updates
            every product in it.
          </p>
        </div>
      </div>

      <form className="settings-form system-name-form" onSubmit={add}>
        <label className="field">
          <span>New category</span>
          <input
            className="text-input"
            value={name}
            placeholder="e.g. Dairy"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="button-primary">
            Add
          </button>
        </div>
      </form>

      <form onSubmit={saveEdit}>
        <div className="table-scroll settings-table-wrap">
          <table className="transactions-table settings-table">
            <thead>
              <tr>
                <th>CATEGORY</th>
                <th>PRODUCTS</th>
                <th className="settings-actions-head">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {items.map((category) => (
                <tr key={category.id}>
                  <td>
                    {editingId === category.id ? (
                      <input
                        className="text-input"
                        value={editName}
                        autoFocus
                        aria-label="Category name"
                        onChange={(event) => setEditName(event.target.value)}
                        onKeyDown={(event) =>
                          event.key === "Escape" && setEditingId(null)
                        }
                      />
                    ) : (
                      category.name
                    )}
                  </td>
                  <td>{category.product_count}</td>
                  <td>
                    <div className="row-actions">
                      {editingId === category.id ? (
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
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => {
                              setEditingId(category.id);
                              setEditName(category.name);
                              setError("");
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="text-link danger-link"
                            disabled={category.product_count > 0}
                            title={
                              category.product_count > 0
                                ? "Move its products to another category first"
                                : undefined
                            }
                            onClick={() =>
                              run(() => api.deleteCategory(category.id))
                            }
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {items.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-state">
                    No categories yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </form>

      {error && <div className="api-error settings-error">{error}</div>}
    </section>
  );
}