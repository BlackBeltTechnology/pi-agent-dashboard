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
         // Populate form with existing data if available, or defaults
         const existing = data[activeView.id]?.[0] || data[activeView.dataEvent || ""]?.[0] || {};
         const initialData: Record<string, any> = { ...existing };
         activeView.fields?.forEach(f => {
            if (initialData[f.key] === undefined) {
              if (f.type === "select" && f.options?.[0]) initialData[f.key] = f.options[0].value;
              else if (f.type === "boolean") initialData[f.key] = false;
            }
         });
         setFormData(initialData);
      }
    }
  }, [activeViewId, data]);

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

  const renderField = (f: UiField) => {
    return (
      <div key={f.key} className="space-y-1">
        <label className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider block">
          {f.label} {f.required && <span className="text-red-500">*</span>}
        </label>
        {f.description && (
          <p className="text-[10px] text-[var(--text-tertiary)] leading-tight mb-1.5">
            {f.description}
          </p>
        )}
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
        ) : f.type === "boolean" ? (
          <div className="flex items-center gap-2 py-1">
             <button
               type="button"
               onClick={() => setFormData({ ...formData, [f.key]: !formData[f.key] })}
               className={`relative w-8 h-4 rounded-full transition-colors ${formData[f.key] ? "bg-blue-600" : "bg-[var(--bg-tertiary)]"}`}
             >
               <span className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${formData[f.key] ? "translate-x-4" : "translate-x-0"}`} />
             </button>
             <span className="text-xs text-[var(--text-secondary)]">{formData[f.key] ? "Enabled" : "Disabled"}</span>
          </div>
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
    );
  };

  const renderForm = (view: UiView) => {
    const fieldsByKey = new Map(view.fields?.map(f => [f.key, f]));
    const usedFieldKeys = new Set<string>();

    return (
      <form className="space-y-6" onSubmit={(e) => {
        e.preventDefault();
        const primaryAction = view.actions?.find(a => a.variant === 'primary') || view.actions?.[0];
        if (primaryAction) handleAction(primaryAction, formData);
      }}>
        <div className="space-y-6">
          {/* Render Sections */}
          {view.sections?.map((section, sIdx) => (
            <div key={sIdx} className="space-y-3">
              <div className="border-b border-[var(--border-subtle)] pb-1 mb-2">
                 <h4 className="text-xs font-bold text-[var(--text-primary)]">{section.title}</h4>
                 {section.description && <p className="text-[10px] text-[var(--text-muted)]">{section.description}</p>}
              </div>
              <div className="grid grid-cols-1 gap-4">
                {section.fields.map(key => {
                  const f = fieldsByKey.get(key);
                  if (!f) return null;
                  usedFieldKeys.add(key);
                  return renderField(f);
                })}
              </div>
            </div>
          ))}

          {/* Render Un-sectioned Fields */}
          <div className="grid grid-cols-1 gap-4">
            {view.fields?.filter(f => !usedFieldKeys.has(f.key)).map(f => renderField(f))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)] mt-4">
           {view.actions?.map((action, idx) => (
             <button
                key={idx}
                type={action.variant === 'primary' ? 'submit' : 'button'}
                onClick={() => action.variant !== 'primary' && handleAction(action, formData)}
                className={`text-xs px-4 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors ${
                  action.variant === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20' :
                  action.variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-500' :
                  'border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50'
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

  const viewsByCategory = useMemo(() => {
    const groups: Record<string, UiView[]> = {};
    module.views.forEach(v => {
      const cat = v.category || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(v);
    });
    return groups;
  }, [module.views]);

  const showSidebar = module.views.length > 1;

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onCancel} />
        <div className={`relative bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] shadow-2xl w-[90vw] ${showSidebar ? 'max-w-4xl' : 'max-w-2xl'} flex flex-col max-h-[85vh]`}>
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

          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            {showSidebar && (
              <div className="w-56 border-r border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/30 overflow-y-auto p-2">
                {Object.entries(viewsByCategory).map(([cat, views]) => (
                  <div key={cat} className="mb-4">
                    {cat !== "General" && (
                      <div className="px-3 py-1 text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-widest">
                        {cat}
                      </div>
                    )}
                    <div className="space-y-0.5 mt-1">
                      {views.map(v => (
                        <button
                          key={v.id}
                          onClick={() => setActiveViewId(v.id)}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                            activeViewId === v.id 
                              ? "bg-blue-500/10 text-blue-500 font-medium" 
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          {v.title || v.id}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* View Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeView?.type === "table" ? renderTable(activeView) : 
                activeView?.type === "form" ? renderForm(activeView) : 
                <div className="py-8 text-center text-red-400">Unknown view type: {activeView?.type}</div>}
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex justify-end items-center">
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
