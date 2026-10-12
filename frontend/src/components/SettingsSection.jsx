import { ChevronDown } from "lucide-react";

// Collapsible Settings section: a compact row (icon, title, one-line
// summary) that opens to show its controls. Keeps the Settings page about
// one phone screen long instead of ~4 when everything was expanded.
function SettingsSection({ id, icon: Icon, iconClass = "text-green-600 dark:text-green-400", title, summary, open, onToggle, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
      <button
        onClick={() => onToggle(open ? null : id)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <Icon size={18} className={`flex-shrink-0 ${iconClass}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900 dark:text-white">{title}</span>
          {summary && <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{summary}</span>}
        </span>
        <ChevronDown size={18} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-slate-200 dark:border-slate-800">{<div className="pt-3">{children}</div>}</div>}
    </section>
  );
}

export default SettingsSection;
