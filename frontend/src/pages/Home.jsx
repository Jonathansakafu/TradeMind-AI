import { Link } from "react-router-dom";
import { Brain, TrendingUp, Shield, BarChart2 } from "lucide-react";

function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* NAV */}
      <nav className="flex items-center justify-between px-10 py-6 border-b border-slate-800">
        <h1 className="text-2xl font-bold text-green-400">TradeMind AI</h1>
        <div className="flex gap-3">
          <Link to="/login" className="px-5 py-2.5 rounded-xl text-slate-400 hover:text-white transition font-medium">
            Login
          </Link>
           <Link to="/register" className="bg-green-500 hover:bg-green-600 px-8 py-4 rounded-xl font-bold text-lg transition text-slate-950">
            Start Free
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <div className="text-center py-24 px-6">
        <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-4 py-2 rounded-full text-green-400 text-sm mb-8">
          <Brain size={14} /> Powered by Sakafu AI
        </div>
        <h1 className="text-6xl font-bold mb-6 leading-tight">
          Your Forex Journal<br />
          <span className="text-green-400">With AI Intelligence</span>
        </h1>
        <p className="text-slate-400 text-xl mb-10 max-w-xl mx-auto">
          Record trades, upload screenshots, and let AI analyze your patterns to make you a better trader.
        </p>
        <div className="flex gap-4 justify-center">
          <Link to="/register" className="bg-green-500 hover:bg-green-600 px-8 py-4 rounded-xl font-bold text-lg transition text-slate-950">
            Start Free
          </Link>
          <Link to="/login" className="bg-slate-900 hover:bg-slate-800 border border-slate-700 px-8 py-4 rounded-xl font-bold text-lg transition">
            Login
          </Link>
        </div>
      </div>

      {/* FEATURES */}
      <div className="grid md:grid-cols-4 gap-6 px-10 pb-20">
        {[
          { icon: TrendingUp, title: "Trade Journal", desc: "Record every trade with screenshots and notes", color: "text-green-400" },
          { icon: Brain, title: "AI Analysis", desc: "Platform has AI that detects patterns and risky behaviors", color: "text-blue-400" },
          { icon: BarChart2, title: "Win Rate", desc: "Track your performance with detailed analytics", color: "text-yellow-400" },
          { icon: Shield, title: "Risk Detection", desc: "AI warns you before you make bad trades", color: "text-red-400" },
        ].map(({ icon: Icon, title, desc, color }) => (
          <div key={title} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <Icon size={28} className={`${color} mb-4`} />
            <h3 className="font-bold text-lg mb-2">{title}</h3>
            <p className="text-slate-400 text-sm">{desc}</p>
          </div>
        ))}
      </div>

    </div>
  );
}

export default Home;