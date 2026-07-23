import { useState } from "react";
import MainLayout from "../layouts/MainLayout";
import { GUIDE_SECTIONS } from "../data/guideSections";
import { BookOpen } from "lucide-react";

function Guide() {
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0].id);
  const active = GUIDE_SECTIONS.find((s) => s.id === activeId) || GUIDE_SECTIONS[0];

  return (
    <MainLayout>
      <div className="mb-8">
        <h2 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
          <BookOpen className="text-green-400" size={32} />
          User Guide
        </h2>
        <p className="text-slate-400 mt-2">
          Everything you need to know to use TradeMind AI
        </p>
      </div>

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-6">

        {/* Section nav — horizontal scroll on mobile, sticky sidebar on desktop */}
        <nav className="mb-6 lg:mb-0">
          <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 lg:sticky lg:top-6 -mx-4 px-4 lg:mx-0 lg:px-0">
            {GUIDE_SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`flex-shrink-0 text-left px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap lg:whitespace-normal transition ${
                  activeId === s.id
                    ? "bg-green-500 text-slate-950"
                    : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </nav>

        {/* Active section content */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 min-w-0">
          <h3 className="text-2xl font-bold text-white mb-4">{active.title}</h3>
          <p className="text-slate-300 leading-relaxed whitespace-pre-line">
            {active.body}
          </p>
        </div>
      </div>
    </MainLayout>
  );
}

export default Guide;
