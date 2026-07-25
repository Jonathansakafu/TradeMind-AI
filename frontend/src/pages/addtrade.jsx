import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import { Upload, X, CheckCircle, Calculator, Camera, Sparkles, LineChart } from "lucide-react";
import { API_URL } from "../config/api";
import SnapshotCaptureModal from "../components/SnapshotCaptureModal";

const PAIRS = [
  "EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD",
  "USDCAD","NZDUSD","GBPJPY","EURJPY","XAUUSD",
  "EURGBP","AUDCAD","AUDCHF","AUDJPY","CADJPY",
  "BTCUSD","ETHUSD","XRPUSD","BNBUSD","SOLUSD",
];

const SETUPS = [
  "Break of Structure","Order Block","Fair Value Gap",
  "Support/Resistance","Trend Follow","Reversal",
  "Breakout","ICT Concept","Supply & Demand","Other"
];

const PIP_VALUES = {
  EURUSD: 10, GBPUSD: 10, AUDUSD: 10, NZDUSD: 10,
  USDCAD: 10, USDCHF: 10, EURGBP: 10, AUDCAD: 10,
  AUDCHF: 10, USDJPY: 9.1, GBPJPY: 9.1, EURJPY: 9.1,
  AUDJPY: 9.1, CADJPY: 9.1, XAUUSD: 10,
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1, BNBUSD: 1, SOLUSD: 1,
};

const PIP_DECIMALS = {
  USDJPY: 100, GBPJPY: 100, EURJPY: 100,
  AUDJPY: 100, CADJPY: 100, XAUUSD: 100,
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1, BNBUSD: 1, SOLUSD: 1,
};

const detectSession = () => {
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 22 || utcHour < 7) return "sydney";
  if (utcHour >= 0 && utcHour < 9) return "tokyo";
  if (utcHour >= 8 && utcHour < 13) return "london";
  if (utcHour >= 13 && utcHour < 17) return "overlap";
  return "new_york";
};

const calculatePL = (pair, direction, entryPrice, exitPrice, lotSize) => {
  if (!pair || !entryPrice || !exitPrice || !lotSize) return null;
  const entry = parseFloat(entryPrice);
  const exit = parseFloat(exitPrice);
  const lots = parseFloat(lotSize);
  if (isNaN(entry) || isNaN(exit) || isNaN(lots)) return null;
  const pipDecimal = PIP_DECIMALS[pair] || 10000;
  const pipValue = PIP_VALUES[pair] || 10;
  const priceDiff = direction === "buy" ? exit - entry : entry - exit;
  const pips = priceDiff * pipDecimal;
  const pl = pips * pipValue * lots;
  return {
    pips: pips.toFixed(1),
    pl: pl.toFixed(2),
    outcome: pl > 0 ? "win" : pl < 0 ? "loss" : "breakeven",
  };
};

function AddTrade() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("token");
  const [loading, setLoading] = useState(false);
  const [screenshot, setScreenshot] = useState(null);
  const [preview, setPreview] = useState(null);
  const [calculated, setCalculated] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectedSetup, setDetectedSetup] = useState(null);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const screenCaptureSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  // Get signal data from navigation state or sessionStorage
  const getSignalData = () => {
    if (location.state?.signal) return location.state.signal;
    const pending = sessionStorage.getItem("pendingSignal");
    if (pending) {
      sessionStorage.removeItem("pendingSignal");
      try { return JSON.parse(pending); } catch { return null; }
    }
    return null;
  };

  const signalData = getSignalData();

  const [form, setForm] = useState({
    pair: signalData?.pair || "",
    direction: signalData?.signal === "buy" ? "buy"
      : signalData?.signal === "sell" ? "sell" : "",
    entryPrice: signalData?.entry ? String(signalData.entry) : "",
    exitPrice: "",
    stopLoss: signalData?.stopLoss ? String(signalData.stopLoss) : "",
    takeProfit: signalData?.takeProfit ? String(signalData.takeProfit) : "",
    lotSize: "",
    setup: "",
    notes: signalData
      ? `AI Signal — ${signalData.sourceLabel || "AI Auto"}\n${signalData.reasoning || ""}`
      : "",
    openedAt: new Date().toISOString().slice(0, 16),
    session: detectSession(),
  });

  useEffect(() => {
    const result = calculatePL(
      form.pair, form.direction,
      form.entryPrice, form.exitPrice, form.lotSize
    );
    setCalculated(result);
  }, [form.pair, form.direction, form.entryPrice, form.exitPrice, form.lotSize]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  // Sends the screenshot to Gemini to identify which setup it shows, and
  // pre-fills the Setup field with the result -- the trader can still
  // change it, this just removes the "which strategy was this again"
  // friction that leads to it being left blank.
  const detectStrategy = async (file) => {
    setDetecting(true);
    setDetectedSetup(null);
    try {
      const fd = new FormData();
      fd.append("screenshot", file);
      const res = await axios.post(`${API_URL}/api/ai/detect-strategy`, fd, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
      });
      setDetectedSetup(res.data);
      if (res.data.setup) {
        setForm((f) => ({ ...f, setup: res.data.setup }));
      }
    } catch {
      // Non-critical path -- trader can still pick a setup manually
    } finally {
      setDetecting(false);
    }
  };

  const applyScreenshot = (file) => {
    setScreenshot(file);
    setPreview(URL.createObjectURL(file));
    detectStrategy(file);
  };

  const handleScreenshot = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    applyScreenshot(file);
  };

  // The generated snapshot is a data visual (price levels), not a real
  // chart image, so skipping AI strategy detection avoids wasting a call
  // on an image it can't meaningfully read patterns from.
  const applyGeneratedSnapshot = (file) => {
    setScreenshot(file);
    setPreview(URL.createObjectURL(file));
    setDetectedSetup(null);
  };

  const openSnapshotModal = () => {
    if (!form.pair || !form.direction || !form.entryPrice) {
      alert("Fill in Pair, Direction and Entry Price first so the chart snapshot can be generated.");
      return;
    }
    setShowSnapshotModal(true);
  };

  // Captures a single frame of whatever the trader shares (their MT5/
  // TradingView window) via the browser's native screen-share picker.
  // Browsers require this explicit permission prompt every time -- there
  // is no way for a website to silently screenshot another app, by design.
  const captureScreen = async () => {
    setCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      track.stop();

      canvas.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], `screen-capture-${Date.now()}.png`, { type: "image/png" });
        applyScreenshot(file);
      }, "image/png");
    } catch (err) {
      if (err.name !== "AbortError" && err.name !== "NotAllowedError") {
        alert("Screen capture failed — you can upload a screenshot instead.");
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.pair || !form.direction || !form.entryPrice || !form.lotSize) {
      alert("Please fill required fields: Pair, Direction, Entry Price, Lot Size");
      return;
    }
    if (!screenshot) {
      alert("Please attach a chart screenshot — capture your screen or upload one, so this trade has entry/SL/TP/result visible for future review.");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) formData.append(k, v); });
      if (calculated) {
        formData.append("profitLoss", calculated.pl);
        formData.append("outcome", calculated.outcome);
      }
      formData.append("screenshot", screenshot);
      await axios.post(`${API_URL}/api/trades`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });
      navigate("/history");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to save trade");
    } finally {
      setLoading(false);
    }
  };

  const Field = ({ label, name, type = "text", placeholder, step, required }) => (
    <div>
      <label className="text-sm text-slate-400 mb-1 block">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type={type} name={name} step={step}
        placeholder={placeholder} value={form[name]}
        onChange={handleChange}
        className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-white"
      />
    </div>
  );

  const Select = ({ label, name, options, required, optional }) => (
    <div>
      <label className="text-sm text-slate-400 mb-1 block">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
        {optional && <span className="text-slate-600 ml-1">(optional)</span>}
      </label>
      <select
        name={name} value={form[name]} onChange={handleChange}
        className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-white"
      >
        <option value="">Select...</option>
        {options.map((o) => (
          <option
            key={typeof o === "object" ? o.value : o}
            value={typeof o === "object" ? o.value : o}
          >
            {typeof o === "object" ? o.label : o}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <MainLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h2 className="text-3xl font-bold">Add Trade</h2>
          <p className="text-slate-400 mt-2">
            P&L calculated automatically · Session auto-detected
          </p>
        </div>

        {/* Signal Banner */}
        {signalData && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 mb-6">
            <p className="text-green-400 font-semibold text-sm">
              ✅ Trade pre-filled from AI Signal — {signalData.sourceLabel}
            </p>
            <p className="text-slate-400 text-xs mt-1">
              Review and adjust if needed before saving
            </p>
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">

          {/* Pair + Direction */}
          <div className="grid grid-cols-2 gap-4">
            <Select label="Pair" name="pair" options={PAIRS} required />
            <Select
              label="Direction" name="direction" required
              options={[
                { value: "buy", label: "Buy (Long) 📈" },
                { value: "sell", label: "Sell (Short) 📉" },
              ]}
            />
          </div>

          {/* Entry + Exit */}
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Entry Price" name="entryPrice"
              type="number" step="any" placeholder="1.08500" required
            />
            <Field
              label="Exit Price" name="exitPrice"
              type="number" step="any" placeholder="1.09000"
            />
          </div>

          {/* SL + TP + Lot */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Stop Loss" name="stopLoss" type="number" step="any" placeholder="1.08200" />
            <Field label="Take Profit" name="takeProfit" type="number" step="any" placeholder="1.09200" />
            <Field label="Lot Size" name="lotSize" type="number" step="any" placeholder="0.01" required />
          </div>

          {/* AUTO P&L */}
          {calculated ? (
            <div className={`rounded-xl p-4 border ${
              calculated.outcome === "win" ? "bg-green-500/10 border-green-500/30"
              : calculated.outcome === "loss" ? "bg-red-500/10 border-red-500/30"
              : "bg-slate-700 border-slate-600"
            }`}>
              <div className="flex items-center gap-2 mb-3">
                <Calculator size={16} className="text-green-400" />
                <p className="text-sm font-semibold text-slate-300">Auto Calculation</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Pips</p>
                  <p className={`text-2xl font-bold ${
                    Number(calculated.pips) >= 0 ? "text-green-400" : "text-red-400"
                  }`}>
                    {Number(calculated.pips) >= 0 ? "+" : ""}{calculated.pips}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Profit / Loss</p>
                  <p className={`text-2xl font-bold ${
                    Number(calculated.pl) >= 0 ? "text-green-400" : "text-red-400"
                  }`}>
                    {Number(calculated.pl) >= 0 ? "+" : ""}${calculated.pl}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Outcome</p>
                  <p className={`text-xl font-bold ${
                    calculated.outcome === "win" ? "text-green-400"
                    : calculated.outcome === "loss" ? "text-red-400"
                    : "text-slate-400"
                  }`}>
                    {calculated.outcome === "win" ? "✅ Win"
                      : calculated.outcome === "loss" ? "❌ Loss"
                      : "➖ Even"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl p-4 border border-slate-700 bg-slate-800/50">
              <div className="flex items-center gap-2 text-slate-500">
                <Calculator size={16} />
                <p className="text-sm">
                  Fill Pair, Direction, Entry, Exit and Lot Size — P&L auto-calculated
                </p>
              </div>
            </div>
          )}

          {/* Session — Auto detected */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-1">Trading Session</p>
            <div className="flex items-center justify-between">
              <p className="text-white font-semibold capitalize">{form.session} Session</p>
              <span className="text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-lg">
                Auto-detected ✓
              </span>
            </div>
          </div>

          {/* Screenshot — required: capture from screen or upload a file.
              Attaching one auto-triggers AI strategy detection below. */}
          <div>
            <label className="text-sm text-slate-400 mb-2 block">
              Chart Screenshot <span className="text-red-400">*</span>
              <span className="text-slate-600 ml-1 font-normal">
                (entry, SL, TP, and result should be visible)
              </span>
            </label>
            {preview ? (
              <div className="relative">
                <img
                  src={preview} alt="preview"
                  className="w-full rounded-xl object-cover max-h-52 border border-slate-700"
                />
                <button
                  onClick={() => {
                    setScreenshot(null);
                    setPreview(null);
                    setDetectedSetup(null);
                  }}
                  className="absolute top-2 right-2 bg-slate-900 border border-slate-700 rounded-full p-1.5 hover:bg-red-500/20 transition"
                >
                  <X size={14} className="text-red-400" />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={openSnapshotModal}
                  className="flex flex-col items-center justify-center border-2 border-dashed border-green-500/40 rounded-xl p-6 hover:border-green-500 transition"
                  title="Generate a chart snapshot from your entry/SL/TP — recommended"
                >
                  <LineChart size={24} className="text-green-500 mb-2" />
                  <p className="text-slate-400 text-sm text-center">Generate chart</p>
                  <p className="text-slate-600 text-xs mt-1">Preview entry/SL/TP</p>
                </button>
                <button
                  type="button"
                  onClick={captureScreen}
                  disabled={!screenCaptureSupported || capturing}
                  className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-xl p-6 hover:border-green-500/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  title={screenCaptureSupported ? "Capture your MT5/TradingView screen" : "Screen capture isn't supported in this browser"}
                >
                  {capturing ? (
                    <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-2" />
                  ) : (
                    <Camera size={24} className="text-slate-600 mb-2" />
                  )}
                  <p className="text-slate-500 text-sm text-center">
                    {capturing ? "Capturing..." : "Capture screen"}
                  </p>
                  <p className="text-slate-600 text-xs mt-1">Share trading platform</p>
                </button>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-xl p-6 cursor-pointer hover:border-green-500/50 transition">
                  <Upload size={24} className="text-slate-600 mb-2" />
                  <p className="text-slate-500 text-sm text-center">Upload file</p>
                  <p className="text-slate-600 text-xs mt-1">PNG, JPG up to 10MB</p>
                  <input
                    type="file" accept="image/*"
                    onChange={handleScreenshot} className="hidden"
                  />
                </label>
              </div>
            )}
          </div>

          <SnapshotCaptureModal
            open={showSnapshotModal}
            onClose={() => setShowSnapshotModal(false)}
            onCaptured={applyGeneratedSnapshot}
            title="Chart Snapshot Preview"
            pair={form.pair}
            direction={form.direction}
            entry={form.entryPrice}
            stopLoss={form.stopLoss}
            takeProfit={form.takeProfit}
            markerPrice={form.entryPrice}
            markerLabel="Entry"
          />

          {/* Setup — auto-filled from the screenshot when possible */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-slate-400">
                Trading Setup <span className="text-slate-600">(optional)</span>
              </label>
              {detecting && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <div className="w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                  AI detecting strategy...
                </span>
              )}
              {!detecting && detectedSetup && detectedSetup.confidence > 0 && (
                <span className="flex items-center gap-1 text-xs text-purple-300" title={detectedSetup.reasoning}>
                  <Sparkles size={12} />
                  AI suggested ({detectedSetup.confidence}%)
                </span>
              )}
            </div>
            <select
              name="setup" value={form.setup} onChange={handleChange}
              className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-white"
            >
              <option value="">Select...</option>
              {SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {detectedSetup?.reasoning && (
              <p className="text-xs text-slate-500 mt-1.5">{detectedSetup.reasoning}</p>
            )}
          </div>

          {/* Date */}
          <Field label="Date & Time" name="openedAt" type="datetime-local" />

          {/* Notes */}
          <div>
            <label className="text-sm text-slate-400 mb-1 block">
              Notes <span className="text-slate-600">(optional)</span>
            </label>
            <textarea
              name="notes" value={form.notes}
              onChange={handleChange} rows={3}
              placeholder="Trade setup, reasons, emotions..."
              className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-white resize-none"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit} disabled={loading}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold p-4 rounded-xl transition flex items-center justify-center gap-2 text-lg"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <><CheckCircle size={20} /> Save Trade</>
            )}
          </button>

        </div>
      </div>
    </MainLayout>
  );
}

export default AddTrade;