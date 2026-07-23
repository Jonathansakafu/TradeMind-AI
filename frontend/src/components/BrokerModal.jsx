import { X, ExternalLink } from "lucide-react";
import { MT5_BROKERS } from "../config/brokers";

function BrokerModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[998] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <p className="font-bold text-white text-sm">Select your broker</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto">
          {MT5_BROKERS.map((broker) => (
            <button
              key={broker.name}
              onClick={() => {
                window.open(broker.url, "_blank");
                onClose();
              }}
              className="flex items-center justify-between w-full px-5 py-3.5 hover:bg-slate-800 transition text-sm text-slate-300 hover:text-white text-left border-b border-slate-800/50 last:border-0"
            >
              {broker.name}
              <ExternalLink size={13} className="text-slate-500 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BrokerModal;
