import { useWorkspace } from "../context/WorkspaceContext";

export default function TabBar() {
  const { tabs, activeId, setActiveId, closeTab } = useWorkspace();

  return (
    <div className="flex h-11 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2 pt-1.5">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            className={`group flex min-w-[9rem] max-w-[14rem] cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-3 text-sm transition ${
              active
                ? "border-slate-200 bg-slate-50 text-slate-900 shadow-[inset_0_2px_0_0_theme(colors.indigo.600)]"
                : "border-transparent text-slate-500 hover:bg-slate-50/70"
            }`}
          >
            <span className="truncate">{tab.title}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="ml-auto rounded px-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
