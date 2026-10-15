import { useEffect, useState } from "react";
import axios from "axios";
import { Microscope } from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";

// Performance page: what the post-mortems of past signals found -- the
// conditions that keep losing (avoid) or winning (favour), and the AI's
// daily summary. The same lessons are given to the signal AI.
function LessonsLearned({ card }) {
  const { headers } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    axios.get(`${API_URL}/api/notifications/lessons`, { headers }).then((r) => setData(r.data)).catch(() => setData({ byPair: {}, summary: [] }));
  }, [headers]);
  if (!data) return null;
  const pairs = Object.entries(data.byPair || {}).filter(([, l]) => l.length);
  return (
    <div className={card}>
      <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2"><Microscope size={18} className="text-green-600 dark:text-green-400" /> Lessons learned</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">From post-mortems of every signal that hit TP or SL — also given to the signal AI so it stops repeating losing patterns.</p>
      {!pairs.length && !data.summary?.length ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Not enough results yet — lessons appear after about 6 scored signals per pair and direction.</p>
      ) : (
        <div className="space-y-3">
          {data.summary?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">This week (AI research)</p>
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200 list-disc ps-5">{data.summary.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {pairs.map(([pair, lessons]) => (
            <div key={pair}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{pair}</p>
              <ul className="space-y-1 text-sm">
                {lessons.map((l) => {
                  const avoid = l.startsWith("AVOID");
                  return (
                    <li key={l} className={`rounded-lg px-2.5 py-1.5 ${avoid ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-green-500/10 text-green-700 dark:text-green-300"}`}>
                      {avoid ? "⛔" : "✅"} {l.replace(/^(AVOID|FAVOUR) /, "")}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LessonsLearned;
