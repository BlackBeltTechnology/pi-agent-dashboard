import React, { useState, useEffect, useMemo } from "react";
import { Icon } from "@mdi/react";
import * as mdi from "@mdi/js";
import { DialogPortal } from "./DialogPortal.js";
import type { ExtensionUiModule, UiView, UiAction, UiField } from "@blackbelt-technology/pi-dashboard-shared/types.js";

interface Props {
  module: ExtensionUiModule;
  data: Record<string, any[]>; // Data for each view, keyed by view.id or dataEvent
  onAction: (action: UiAction, params?: Record<string, any>) => void;
  onCancel: () => void;
  onRefresh: (view: UiView) => void;
}

export function GenericExtensionDialog({
  module,
  data,
  onAction,
  onCancel,
  onRefresh,
}: Props) {
  const [activeViewId, setActiveViewId] = useState(module.initialViewId);
  const activeView = useMemo(() => 
    module.views.find(v => v.id === activeViewId) || module.views[0],
  [module, activeViewId]);

  const [formData, setFormData] = useState<Record<string, any>>({});

  // Refresh data and reset form when view changes
  useEffect(() => {
    if (activeView) {
      onRefresh(activeView);
      if (activeView.type === "form") {
         // Reset form with default values or empty
         const initialData: Record<string, any> = {};
         activeView.fields?.forEach(f => {
            if (f.type === "select" && f.options?.[0]) initialData[f.key] = f.options[0].value;
         });
         setFormData(initialData);
      }
    }
  }, [activeViewId]);

  const handleAction = (action: UiAction, item?: any) => {
    if (action.emit === "ui:navigate") {
      if (action.params?.viewId) setActiveViewId(action.params.viewId);
      return;
    }

    if (action.confirm && !window.confirm(action.confirm)) return;
    
    let params = { ...action.params };
    if (item && action.primaryParam) {
      params[action.primaryParam] = item.id || item.name || item.key;
    }

    // Merge form data if this is a submission from a form
    if (activeView.type === "form") {
       params = { ...params, ...formData };
       // For forms, we usually want to navigate back to list ONLY on success.
       // Since the dashboard protocol is fire-and-forget, we'll assume success 
       // but maybe allow the extension to control this in the future.
       // For now, let's auto-navigate back only if it's NOT a custom emit.
       if (action.emit.includes("add-request") || action.emit.includes("create")) {
          setActiveViewId(module.initialViewId);
       }
    }
    
    onAction(action, params);
  };

  const renderIcon = (iconName?: string, size = 0.7, className = "") => {
    if (!iconName) return null;
    const path = (mdi as any)[`mdi${iconName.charAt(0).toUpperCase()}${iconName.slice(1)}`];
    if (!path) return null;
    return <Icon path={path} size={size} className={className} />;
  };

  const renderTable = (view: UiView) => {
    const items = data[view.id] || data[view.dataEvent || ""] || [];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              {view.fields?.map(f => (
                <th key={f.key} className="px-3 py-2 font-bold text-[var(--text-muted)] uppercase tracking-wider">
                  {f.label}
                </th>
              ))}
              {view.itemActions && <th className="px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={(view.fields?.length || 0) + 1} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  No items found
                </td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <tr key={item.id || idx} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/30">
                  {view.fields?.map(f => (
                    <td key={f.key} className="px-3 py-2 text-[var(--text-secondary)]">
                      {f.type === "code" ? (
                        <code className="bg-[var(--bg-tertiary)] px-1 rounded font-mono text-[10px]">{item[f.key]}</code>
                      ) : f.type === "boolean" ? (
                        <span>{item[f.key] ? "✓" : "✗"}</span>
                      ) : (
                        item[f.key]
                      )}
                    </td>
                  ))}
                  {view.itemActions && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {view.itemActions.map((action, aIdx) => (
                        <button
                          key={aIdx}
                          onClick={() => handleAction(action, item)}
                          className={`p-1.5 rounded-lg transition-colors ml-1 ${
                            action.variant === 'danger' ? 'text-red-500 hover:bg-red-500/10' : 
                            action.variant === 'warning' ? 'text-orange-500 hover:bg-orange-500/10' :
                            'text-blue-500 hover:bg-blue-500/10'
                          }`}
                          title={action.label}
                        >
                          {renderIcon(action.icon, 0.6) || action.label}
                        </button>
                      ))}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderForm = (view: UiView) => {
    return (
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        const primaryAction = view.actions?.find(a => a.variant === 'primary') || view.actions?.[0];
        if (primaryAction) handleAction(primaryAction, formData);
      }}>
        <div className="grid grid-cols-1 gap-4">
          {view.fields?.map(f => (
            <div key={f.key} className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">
                {f.label} {f.required && <span className="text-red-500">*</span>}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  value={formData[f.key] || ""}
                  onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-blue-500/50"
                  rows={3}
                  required={f.required}
                />
              ) : f.type === "select" ? (
                <select
                  value={formData[f.key] || ""}
                  onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-blue-500/50"
                >
                  {f.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  value={formData[f.key] || ""}
                  onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-blue-500/50"
                  required={f.required}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
           {view.actions?.map((action, idx) => (
             <button
                key={idx}
                type={action.variant === 'primary' ? 'submit' : 'button'}
                onClick={() => action.variant !== 'primary' && handleAction(action, formData)}
                className={`text-xs px-4 py-1.5 rounded-lg flex items-center gap-1.5 ${
                  action.variant === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-500' :
                  action.variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-500' :
                  'border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
             >
               {renderIcon(action.icon, 0.6)}
               {action.label}
             </button>
           ))}
        </div>
      </form>
    );
  };

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onCancel} />
        <div className="relative bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] shadow-2xl w-[90vw] max-w-2xl flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
              {renderIcon(module.icon, 0.8, "text-blue-500")}
              {module.title}
              {activeView?.title && <span className="text-[var(--text-muted)] font-normal ml-1">/ {activeView.title}</span>}
            </h3>
            <div className="flex items-center gap-2">
               {activeView?.actions?.filter(a => a.variant !== 'primary').map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAction(action)}
                    className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-500/10 transition-colors"
                    title={action.label}
                  >
                    {renderIcon(action.icon, 0.7) || action.label}
                  </button>
               ))}
               <button onClick={onCancel} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <Icon path={mdi.mdiClose} size={0.7} />
               </button>
            </div>
          </div>

          {/* View Content */}
          <div className="flex-1 overflow-y-auto p-4">
             {activeView?.type === "table" ? renderTable(activeView) : 
              activeView?.type === "form" ? renderForm(activeView) : 
              <div className="py-8 text-center text-red-400">Unknown view type: {activeView?.type}</div>}
          </div>

          {/* Footer / Navigation */}
          <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex justify-between items-center">
            <div className="flex gap-1">
               {module.views.length > 1 && module.views.map(v => (
                 <button
                   key={v.id}
                   onClick={() => setActiveViewId(v.id)}
                   className={`px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                     activeViewId === v.id ? "bg-blue-500/10 text-blue-500" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                   }`}
                 >
                   {v.title || v.id}
                 </button>
               ))}
            </div>
            <button
              onClick={onCancel}
              className="text-xs px-3 py-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
