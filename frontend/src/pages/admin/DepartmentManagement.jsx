// frontend/src/pages/admin/DepartmentManagement.jsx
// Departments (DESIGN_RULES §6/§8/§12): title + Add, a sortable table whose rows
// open the edit drawer; designations are edited as removable chips.
import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Trash2, RotateCcw, Building2, Loader2 } from '../../components/icons';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import { getApiErrorMessage } from '../../utils/apiError';
import useAuth from '../../hooks/useAuth';
import Pagination from '../../components/shared/Pagination';
import { PageHeader, Toolbar, Th, SkeletonRows, Empty, Field, Drawer } from '../../components/ui';
import useSort from '../../lib/useSort';

const EMPTY = { name: '', code: '', description: '', designations: [] };

export default function DepartmentManagement() {
  const { user } = useAuth();
  const [depts,      setDepts]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [isOpen,     setIsOpen]     = useState(false);
  const [editDept,   setEditDept]   = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);
  const [desigInput, setDesigInput] = useState('');
  // Edit only: the department's saved designations, and the ones marked for removal
  const [existingDesigs, setExistingDesigs] = useState([]);
  const [removedIds,     setRemovedIds]     = useState([]);
  const [desigLoading,   setDesigLoading]   = useState(false);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 10;

  const fetchDepts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      const res = await apiClient.get('/departments', { params });
      const data = res.data?.data;
      setDepts(data?.departments ?? []);
      setTotalPages(data?.pagination?.pages ?? 1);
      setTotalCount(data?.pagination?.total ?? 0);
    } catch { toast.error('Failed to load departments.'); }
    finally  { setLoading(false); }
  }, [page]);

  useEffect(() => { fetchDepts(); }, [fetchDepts]);

  const openAdd  = () => {
    setEditDept(null); setForm(EMPTY); setDesigInput('');
    setExistingDesigs([]); setRemovedIds([]);
    setIsOpen(true);
  };
  const openEdit = (d) => {
    setEditDept(d);
    setForm({ name: d.name, code: d.code, description: d.description ?? '', designations: [] });
    setDesigInput('');
    setExistingDesigs([]); setRemovedIds([]);
    setIsOpen(true);
    setDesigLoading(true);
    apiClient.get('/designations', { params: { department_id: d.id } })
      .then(res => setExistingDesigs(res.data?.data ?? []))
      .catch(() => toast.error('Could not load the designations.'))
      .finally(() => setDesigLoading(false));
  };
  const close = () => { setIsOpen(false); setEditDept(null); };

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  // ── Designation tag input ──────────────────────────────────────────────────
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

  const addDesignation = () => {
    const val = desigInput.trim();
    if (!val) return;
    // Re-adding a saved one that was marked for removal just keeps it
    const removedMatch = existingDesigs.find(d => removedIds.includes(d.id) && sameName(d.name, val));
    if (removedMatch) {
      setRemovedIds(ids => ids.filter(id => id !== removedMatch.id));
      setDesigInput('');
      return;
    }
    const taken = form.designations.some(n => sameName(n, val))
      || existingDesigs.some(d => !removedIds.includes(d.id) && sameName(d.name, val));
    if (taken) { toast.error(`"${val}" already added.`); return; }
    setForm(f => ({ ...f, designations: [...f.designations, val] }));
    setDesigInput('');
  };

  /** Marks a saved designation for removal on save (click again to keep it). */
  const toggleRemoveExisting = (id) =>
    setRemovedIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

  const removeDesignation = (name) =>
    setForm(f => ({ ...f, designations: f.designations.filter(d => d !== name) }));

  const handleDesigKeyDown = (e) => {
    if (e.key === 'Enter')     { e.preventDefault(); addDesignation(); }
    if (e.key === 'Backspace' && !desigInput && form.designations.length > 0)
      setForm(f => ({ ...f, designations: f.designations.slice(0, -1) }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.code.trim()) return toast.error('Name and code are required.');
    setSaving(true);
    try {
      if (editDept) {
        await apiClient.put(`/departments/${editDept.id}`, {
          name: form.name,
          code: form.code.toUpperCase(),
          description: form.description,
        });

        // Designation changes: add the new ones, then remove the marked ones
        // (a removal is refused while users still hold that designation)
        const problems = [];
        if (form.designations.length > 0) {
          try {
            await apiClient.post('/designations/bulk', { department_id: editDept.id, names: form.designations });
          } catch (err) {
            problems.push(getApiErrorMessage(err, 'New designations could not be added.'));
          }
        }
        for (const id of removedIds) {
          const name = existingDesigs.find(d => d.id === id)?.name ?? 'Designation';
          try {
            await apiClient.delete(`/designations/${id}`);
          } catch (err) {
            problems.push(`${name}: ${getApiErrorMessage(err, 'could not be removed.')}`);
          }
        }
        if (problems.length) toast.error(`Department saved, but:\n${problems.join('\n')}`, { duration: 7000 });
        else toast.success('Department updated.');
      } else {
        await apiClient.post('/departments', {
          name:         form.name,
          code:         form.code.toUpperCase(),
          description:  form.description,
          unit_id:      user?.unit_id,
          designations: form.designations,
        });
        toast.success('Department created.');
      }
      close();
      fetchDepts();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to save department.'));
    } finally { setSaving(false); }
  };

  const handleDeactivate = async (d) => {
    if (d.user_count > 0) return toast.error(`Cannot deactivate — ${d.user_count} user(s) still assigned.`);
    if (!window.confirm(`Deactivate "${d.name}"?`)) return;
    try {
      await apiClient.delete(`/departments/${d.id}`);
      toast.success('Department deactivated.');
      fetchDepts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to deactivate.');
    }
  };

  const { rows, sort, onSort } = useSort(depts, {
    name: (d) => d.name,
    code: (d) => d.code,
    designations: (d) => Number(d.designation_count ?? 0),
    users: (d) => Number(d.user_count ?? 0),
  });

  const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Departments"
        actions={<button type="button" onClick={openAdd} className="btn-primary"><Plus size={14} /> Add department</button>}
      />

      <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? 'department' : 'departments'} />

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
              <Th sortKey="code" sort={sort} onSort={onSort}>Code</Th>
              <th>Description</th>
              <Th sortKey="designations" sort={sort} onSort={onSort} align="right">Designations</Th>
              <Th sortKey="users" sort={sort} onSort={onSort} align="right">Users</Th>
              <th className="w-10"><span className="sr-only">Deactivate</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="!p-0">
                  <Empty
                    icon={Building2}
                    title="No departments yet"
                    hint="Add a department, then its designations, before adding users."
                    action={<button type="button" onClick={openAdd} className="btn-outline"><Plus size={14} /> Add department</button>}
                  />
                </td>
              </tr>
            ) : rows.map(d => (
              <tr key={d.id} className="is-clickable" onClick={() => openEdit(d)}>
                <td className="font-medium">{d.name}</td>
                <td className="mono">{d.code}</td>
                <td className="max-w-xs truncate text-ink-2">{d.description || '—'}</td>
                <td className="num">{d.designation_count ?? 0}</td>
                <td className="num">{d.user_count ?? 0}</td>
                <td>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeactivate(d); }}
                    className="btn-icon"
                    aria-label={`Deactivate ${d.name}`}
                    title={d.user_count > 0 ? `${plural(d.user_count, 'user')} still assigned` : 'Deactivate'}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={(p) => setPage(p)} />}

      <Drawer
        open={isOpen}
        onClose={close}
        busy={saving}
        width={520}
        icon={Building2}
        title={editDept ? `Edit ${editDept.name}` : 'New department'}
        subtitle={editDept ? `${plural(editDept.user_count ?? 0, 'user')} · ${plural(editDept.designation_count ?? 0, 'designation')}` : 'Add a department to this unit'}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={close} disabled={saving}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : editDept ? 'Save changes' : 'Create department'}
            </button>
          </>
        )}
      >
        <div className="tile space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <Field label="Department name" htmlFor="dept-name" required>
              <input id="dept-name" className="control" name="name" value={form.name} onChange={handleChange} placeholder="e.g. Engineering" />
            </Field>
            <Field label="Code" htmlFor="dept-code" required>
              <input id="dept-code" className="control mono" name="code" value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="ENG" />
            </Field>
          </div>
          <Field label="Description" htmlFor="dept-desc">
            <textarea id="dept-desc" className="control resize-none" rows={3} name="description"
              value={form.description} onChange={handleChange} placeholder="Optional" />
          </Field>
        </div>

        <div className="tile mt-3">
          <p className="field-label">Designations</p>

          {/* Saved designations (edit) — ✕ marks one for removal, ↺ keeps it */}
          {editDept && (
            desigLoading ? (
              <p className="text-[12px] text-muted mb-2 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading designations…</p>
            ) : existingDesigs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {existingDesigs.map(d => {
                  const removed = removedIds.includes(d.id);
                  return (
                    <span key={d.id} className={`chip${removed ? ' is-removed' : ''}`}
                      title={removed ? 'Removed when you save' : undefined}>
                      {d.name}
                      <button type="button" className="chip-x" onClick={() => toggleRemoveExisting(d.id)}
                        aria-label={removed ? `Keep ${d.name}` : `Remove ${d.name}`} title={removed ? 'Keep' : 'Remove'}>
                        {removed ? <RotateCcw size={11} /> : <X size={11} />}
                      </button>
                    </span>
                  );
                })}
              </div>
            )
          )}

          {/* New designations (not saved yet) */}
          {form.designations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.designations.map(name => (
                <span key={name} className="chip is-new" title="New, added when you save">
                  {name}
                  <button type="button" className="chip-x" onClick={() => removeDesignation(name)}
                    aria-label={`Remove ${name}`} title="Remove">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              className="control flex-1"
              value={desigInput}
              onChange={e => setDesigInput(e.target.value)}
              onKeyDown={handleDesigKeyDown}
              placeholder="e.g. Senior Engineer"
              aria-label="New designation"
            />
            <button type="button" onClick={addDesignation} className="btn-outline" disabled={!desigInput.trim()}>
              <Plus size={14} /> Add
            </button>
          </div>
          <p className="field-hint">
            Press Enter to add.{editDept && ' Changes apply when you save.'}
          </p>
        </div>
      </Drawer>
    </div>
  );
}
