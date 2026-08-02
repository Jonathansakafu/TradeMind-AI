import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API_URL } from "../config/api";

function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async () => {
    if (!password || !confirmPassword) {
      setMessage({ type: "error", text: "Please fill all fields" });
      return;
    }
    if (password !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await axios.post(`${API_URL}/api/auth/reset-password`, {
        email,
        token,
        password,
      });
      setMessage({ type: "success", text: res.data.message });
      setTimeout(() => navigate("/login"), 2000);
    } catch (error) {
      setMessage({ type: "error", text: error.response?.data?.message || "Something went wrong" });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  if (!token || !email) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center text-slate-900 dark:text-white px-4">
        <div className="bg-white dark:bg-slate-900 p-10 rounded-2xl w-full max-w-md shadow-xl text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-3">Invalid Reset Link</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-6">
            This password reset link is missing or malformed. Please request a new one.
          </p>
          <Link
            to="/forgot-password"
            className="inline-block bg-green-500 hover:bg-green-600 px-6 py-3 rounded-xl font-semibold transition"
          >
            Request New Link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center text-slate-900 dark:text-white px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-2xl w-full max-w-md shadow-xl">
        <h1 className="text-4xl font-bold text-center text-green-600 dark:text-green-400 mb-8">
          TradeMind AI
        </h1>
        <h2 className="text-2xl font-semibold mb-6 text-center">Reset Password</h2>
        <div className="space-y-4">
          <input
            type="password"
            placeholder="New Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-100 dark:bg-slate-800 p-4 rounded-xl outline-none placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-green-500 transition"
          />
          <input
            type="password"
            placeholder="Confirm New Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-100 dark:bg-slate-800 p-4 rounded-xl outline-none placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-green-500 transition"
          />
          {message && (
            <div
              className={`text-sm rounded-xl p-3 ${
                message.type === "error"
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 p-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
          >
            {loading
              ? <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              : "Reset Password"
            }
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
