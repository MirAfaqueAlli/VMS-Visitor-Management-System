// frontend/src/pages/admin/DepartmentManagement.jsx
import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { Plus, X, Trash2, Tag } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';

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

  const fetchDepts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/departments');
      setDepts(res.data?.data ?? []);
    } catch { toast.error('Failed to load departments.'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { fetchDepts(); }, [fetchDepts]);

  const openAdd  = () => { setEditDept(null); setForm(EMPTY); setDesigInput(''); setIsOpen(true); };
  const openEdit = (d) => {
    setEditDept(d);
    setForm({ name: d.name, code: d.code, description: d.description ?? '', designations: [] });
    setDesigInput('');
    setIsOpen(true);
  };
  const close = () => { setIsOpen(false); setEditDept(null); };

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  // ── Designation tag input ──────────────────────────────────────────────────
  const addDesignation = () => {
    const val = desigInput.trim();
    if (!val) return;
    if (form.designations.includes(val)) { toast.error(`"${val}" already added.`); return; }
    setForm(f => ({ ...f, designations: [...f.designations, val] }));
    setDesigInput('');
  };

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
        toast.success('Department updated.');
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
      toast.error(err?.response?.data?.message || 'Failed to save.');
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

  return (
    <>
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in space-y-5">
        {/* Sub-tab nav */}
        <div
          className="flex gap-1 p-1 w-fit"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
        >
          {[['Users', '/admin'], ['Departments', '/admin/departments']].map(([label, path]) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/admin'}
              className={() => 'px-4 py-1.5 text-[12px] font-medium transition-colors'}
              style={({ isActive }) => isActive
                ? { background: 'var(--color-accent)', borderRadius: 'var(--radius-sm)', color: '#0f172a' }
                : { borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)' }}
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Table card */}
        <div className="vms-card overflow-hidden">
          <div
            className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <h2 className="font-semibold text-[13px]" style={{ color: 'var(--color-text)' }}>
              Departments
              <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--color-text-faint)' }}>
                ({depts.length})
              </span>
            </h2>
            <button className="btn-primary" onClick={openAdd}>
              <Plus size={14} /> Add Department
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div
                className="w-6 h-6 rounded-full border-2 animate-spin"
                style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }}
              />
            </div>
          ) : depts.length === 0 ? (
            <p className="text-center py-10 text-[12px]" style={{ color: 'var(--color-text-faint)' }}>
              No departments found. Add one to get started.
            </p>
          ) : (
            <table className="vms-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Designations</th>
                  <th>Users</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {depts.map(d => (
                  <tr key={d.id}>
                    <td className="font-medium" style={{ color: 'var(--color-text)' }}>{d.name}</td>
                    <td>
                      <span
                        className="font-mono text-[11px] px-2 py-0.5"
                        style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)', borderRadius: 'var(--radius-sm)' }}
                      >
                        {d.code}
                      </span>
                    </td>
                    <td className="max-w-xs truncate">{d.description || '—'}</td>
                    <td>
                      <span className="text-[11px]" style={{ color: 'var(--color-text-faint)' }}>
                        {d.designation_count ?? 0} designation{d.designation_count !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-active">
                        {d.user_count} user{d.user_count !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button className="btn-secondary py-1 px-3 text-[11px]" onClick={() => openEdit(d)}>
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeactivate(d)}
                          className="p-1.5 transition-colors"
                          style={{ color: 'var(--color-text-faint)', borderRadius: 'var(--radius-sm)' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-bg, #fef2f2)'; e.currentTarget.style.color = 'var(--color-error, #dc2626)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-faint)'; }}
                          title="Deactivate"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-overlay backdrop-blur-sm z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={close}
      />

      {/* Slide-over panel — matches UserManagement panel */}
      <aside
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white border-l border-subtle z-50 flex flex-col shadow-card transition-transform duration-500 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between p-6 border-b border-subtle shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-loud">
              {editDept ? 'Edit' : 'New'} <em className="italic">Department</em>
            </h2>
            <p className="text-xs text-faint mt-0.5">
              {editDept ? `Editing ${editDept.name}` : 'Create a new department'}
            </p>
          </div>
          <button
            onClick={close}
            className="w-9 h-9 rounded-full flex items-center justify-center text-faint hover:bg-bg-primary hover:text-loud transition-colors duration-300"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-widest mb-1.5">
              Department Name *
            </label>
            <input
              className="w-full btn-secondary text-loud text-sm placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border transition-all duration-300"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Engineering"
            />
          </div>

          {/* Code */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-widest mb-1.5">
              Code *
            </label>
            <input
              className="w-full btn-secondary text-loud text-sm font-mono placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border transition-all duration-300"
              name="code"
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="e.g. ENG"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-widest mb-1.5">
              Description
            </label>
            <textarea
              className="w-full btn-secondary text-loud text-sm placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border transition-all duration-300 resize-none"
              rows={3}
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Optional description"
            />
          </div>

          {/* Designations — only on Add */}
          {!editDept && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-widest mb-1">
                Designations
              </label>
              <p className="text-[10px] mb-2" style={{ color: 'var(--color-text-faint)' }}>
                Type a designation and press{' '}
                <kbd style={{ background: 'var(--color-border)', padding: '0 4px', borderRadius: 3, fontSize: 10 }}>Enter</kbd>
                {' '}to add. Click a chip to remove.
              </p>

              {/* Chips */}
              {form.designations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.designations.map(name => (
                    <span
                      key={name}
                      onClick={() => removeDesignation(name)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] cursor-pointer select-none transition-opacity hover:opacity-70"
                      style={{
                        background:   'var(--color-info-bg)',
                        color:        'var(--color-info)',
                        borderRadius: 'var(--radius-sm)',
                        border:       '1px solid var(--color-info)',
                      }}
                      title="Click to remove"
                    >
                      <Tag size={10} />
                      {name}
                      <X size={10} />
                    </span>
                  ))}
                </div>
              )}

              {/* Input row */}
              <div className="flex gap-2">
                <input
                  className="flex-1 btn-secondary text-loud text-sm placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all duration-300"
                  value={desigInput}
                  onChange={e => setDesigInput(e.target.value)}
                  onKeyDown={handleDesigKeyDown}
                  placeholder="e.g. Senior Engineer"
                />
                <button
                  type="button"
                  onClick={addDesignation}
                  className="btn-secondary px-3"
                  disabled={!desigInput.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-subtle flex gap-3 shrink-0">
          <button className="flex-1 btn-secondary" onClick={close}>Cancel</button>
          <button
            className="flex-1 btn-primary flex items-center justify-center gap-2"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? 'Saving…' : editDept ? '✓ Save Changes' : '✓ Create Department'}
          </button>
        </div>
      </aside>
    </>
  );
}
