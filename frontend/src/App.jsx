import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/login";
import Register from "./pages/register";
import Dashboard from "./pages/dashboard";
import AddTrade from "./pages/addtrade";
import TradeHistory from "./pages/TradeHistory";
import Analytics from "./pages/Analytics";
import Charts from "./pages/Charts";
import Settings from "./pages/Settings";
import Home from "./pages/Home";
import LiveAnalysis from "./pages/liveAnalysis";
import News from "./pages/News";
import Notifications from "./pages/Notifications";
import MT5 from "./pages/MT5";
import AskAI from "./pages/AskAI";
import Guide from "./pages/Guide";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/add-trade" element={<ProtectedRoute><AddTrade /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><TradeHistory /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
        <Route path="/live" element={<ProtectedRoute><LiveAnalysis /></ProtectedRoute>} />
        <Route path="/news" element={<ProtectedRoute><News /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/charts" element={<ProtectedRoute><Charts /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/mt5" element={<ProtectedRoute><MT5 /></ProtectedRoute>} />
        <Route path="/ask-ai" element={<ProtectedRoute><AskAI /></ProtectedRoute>} />
        <Route path="/guide" element={<ProtectedRoute><Guide /></ProtectedRoute>} />
      </Routes>
    </Router>
  );
}

export default App;