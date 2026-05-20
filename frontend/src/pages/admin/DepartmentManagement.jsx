// frontend/src/pages/admin/DepartmentManagement.jsx
import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { Plus, X, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';

const EMPTY = { name: '', code: '', description: '' };

export default function DepartmentManagement() {
  const [depts,   setDepts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen,  setIsOpen]  = useState(false);
  const [editDept, setEditDept] = useState(null);
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);

  const fetchDepts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/departments');
      setDepts(res.data?.data ?? []);
    } catch { toast.error('Failed to load departments.'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { fetchDepts(); }, [fetchDepts]);

  const openAdd  = ()  => { setEditDept(null); setForm(EMPTY); setIsOpen(true); };
  const openEdit = (d) => { setEditDept(d); setForm({ name: d.name, code: d.code, description: d.description ?? '' }); setIsOpen(true); };
  const close    = ()  => { setIsOpen(false); setEditDept(null); };

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.code.trim()) return toast.error('Name and code are required.');
    setSaving(true);
    try {
      if (editDept) {
        await apiClient.put(`/departments/${editDept.id}`, form);
        toast.success('Department updated.');
      } else {
        await apiClient.post('/departments', form);
        toast.success('Department created.');
      }
      close(); fetchDepts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save.');
    } finally { setSaving(false); }
  };

  const handleDeactivate = async (d) => {
    if (d.user_count > 0) {
      return toast.error(`Cannot deactivate — ${d.user_count} user${d.user_count !== 1 ? 's are' : ' is'} still assigned.`);
    }
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
    <div className="space-y-5 animate-fade-in">
      {/* Sub-tab nav */}
      <div className="flex gap-1 p-1 w-fit"
           style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        {[['Users', '/admin'], ['Departments', '/admin/departments']].map(([label, path]) => (
          <NavLink key={path} to={path} end={path === '/admin'}
            className={({ isActive }) =>
              `px-4 py-1.5 text-[12px] font-medium transition-colors ${isActive
                ? 'text-[#0f172a]'
                : 'text-muted hover:text-primary'
              }`}
            style={({ isActive }) =>
              isActive ? { background: 'var(--color-accent)', borderRadius: 'var(--radius-sm)' } : { borderRadius: 'var(--radius-sm)' }
            }
          >
            {label}
          </NavLink>
        ))}
      </div>

      {/* Table card */}
      <div className="vms-card overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between"
             style={{ borderBottom: '1px solid var(--color-border)' }}>
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
            <div className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
          </div>
        ) : depts.length === 0 ? (
          <p className="text-center py-10 text-[12px]" style={{ color: 'var(--color-text-faint)' }}>
            No departments found. Add one to get started.
          </p>
        ) : (
          <table className="vms-table">
            <thead>
              <tr><th>Name</th><th>Code</th><th>Description</th><th>Users</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {depts.map(d => (
                <tr key={d.id}>
                  <td className="font-medium" style={{ color: 'var(--color-text)' }}>{d.name}</td>
                  <td>
                    <span className="font-mono text-[11px] px-2 py-0.5"
                          style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)', borderRadius: 'var(--radius-sm)' }}>
                      {d.code}
                    </span>
                  </td>
                  <td className="max-w-xs truncate">{d.description || '—'}</td>
                  <td>
                    <span className="badge badge-active">{d.user_count} user{d.user_count !== 1 ? 's' : ''}</span>
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
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-bg)'; e.currentTarget.style.color = 'var(--color-error)'; }}
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

      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background: 'var(--color-overlay)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 200ms ease',
        }}
        onClick={close}
      />

      {/* Slide-over panel */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: 380,
          background: 'var(--color-bg-secondary)',
          borderLeft: '1px solid var(--color-border)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms ease',
        }}
      >
        <div className="px-5 py-4 flex items-center justify-between shrink-0"
             style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 className="font-semibold text-[13px]" style={{ color: 'var(--color-text)' }}>
            {editDept ? 'Edit Department' : 'Add Department'}
          </h3>
          <button onClick={close} style={{ color: 'var(--color-text-faint)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {[
            { label: 'Department Name *', name: 'name',        type: 'input',    placeholder: 'e.g. Engineering' },
            { label: 'Code *',            name: 'code',        type: 'input',    placeholder: 'e.g. ENG' },
            { label: 'Description',       name: 'description', type: 'textarea', placeholder: 'Optional description' },
          ].map(({ label, name, type, placeholder }) => (
            <div key={name}>
              <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5"
                     style={{ color: 'var(--color-text-faint)' }}>
                {label}
              </label>
              {type === 'textarea' ? (
                <textarea className="vms-input" rows={3} name={name}
                  value={form[name]} onChange={handleChange} placeholder={placeholder} />
              ) : (
                <input className="vms-input" name={name} value={form[name]}
                  onChange={handleChange} placeholder={placeholder} />
              )}
            </div>
          ))}
        </div>

        <div className="px-5 py-4 flex gap-3 shrink-0"
             style={{ borderTop: '1px solid var(--color-border)' }}>
          <button className="btn-secondary flex-1" onClick={close}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : editDept ? 'Save Changes' : 'Create Department'}
          </button>
        </div>
      </div>
    </div>
  );
}
