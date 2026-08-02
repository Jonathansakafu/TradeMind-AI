import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import { Save, User, Lock, CheckCircle, Palette, LogOut } from "lucide-react";
import { API_URL } from "../config/api";
import ThemeToggle from "../components/ThemeToggle";

function Settings() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const [profile, setProfile] = useState({
    name: user.name || "",
    email: user.email || "",
  });

  const [password, setPassword] = useState({
    current: "", newPass: "", confirm: "",
  });

  const [profileMsg, setProfileMsg] = useState(null);
  const [passMsg, setPassMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const updateProfile = async () => {
    setLoading(true);
    try {
      const res = await axios.put(
        `${API_URL}/api/auth/profile`,
        { name: profile.name },
        { headers }
      );
      localStorage.setItem("user", JSON.stringify(res.data));
      setProfileMsg({ type: "success", text: "Profile updated!" });
    } catch (err) {
      setProfileMsg({ type: "error", text: err.response?.data?.message || "Failed" });
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async () => {
    if (password.newPass !== password.confirm) {
      return setPassMsg({ type: "error", text: "Passwords hazilingani" });
    }
    if (password.newPass.length < 6) {
      return setPassMsg({ type: "error", text: "Password iwe na herufi 6+" });
    }
    setLoading(true);
    try {
      await axios.put(
        `${API_URL}/api/auth/password`,
        { currentPassword: password.current, newPassword: password.newPass },
        { headers }
      );
      setPassMsg({ type: "success", text: "Password imebadilishwa!" });
      setPassword({ current: "", newPass: "", confirm: "" });
    } catch (err) {
      setPassMsg({ type: "error", text: err.response?.data?.message || "Failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="mb-8">
        <h2 className="text-4xl font-bold text-slate-900 dark:text-white">Settings</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2">Manage your account</p>
      </div>

      <div className="max-w-xl space-y-6">

        {/* Appearance */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <Palette size={20} className="text-green-600 dark:text-green-400" /> Appearance
          </h3>
          <ThemeToggle variant="inline" />
        </div>

        {/* Profile */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <User size={20} className="text-green-600 dark:text-green-400" /> Profile
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block">Name</label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block">Email</label>
              <input
                type="email"
                value={profile.email}
                disabled
                className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3 rounded-xl text-slate-400 dark:text-slate-500 cursor-not-allowed"
              />
            </div>
            {profileMsg && (
              <p className={`text-sm ${profileMsg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {profileMsg.text}
              </p>
            )}
            <button
              onClick={updateProfile} disabled={loading}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl transition"
            >
              <Save size={16} /> Save Profile
            </button>
          </div>
        </div>

        {/* Password */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <Lock size={20} className="text-green-600 dark:text-green-400" /> Change Password
          </h3>
          <div className="space-y-4">
            {["current", "newPass", "confirm"].map((field) => (
              <div key={field}>
                <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block capitalize">
                  {field === "current" ? "Current Password"
                    : field === "newPass" ? "New Password"
                    : "Confirm New Password"}
                </label>
                <input
                  type="password"
                  value={password[field]}
                  onChange={(e) => setPassword({ ...password, [field]: e.target.value })}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
                />
              </div>
            ))}
            {passMsg && (
              <p className={`text-sm ${passMsg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {passMsg.text}
              </p>
            )}
            <button
              onClick={updatePassword} disabled={loading}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl transition"
            >
              <CheckCircle size={16} /> Update Password
            </button>
          </div>
        </div>

        {/* Account */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <LogOut size={20} className="text-red-500 dark:text-red-400" /> Account
          </h3>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 dark:text-red-400 font-bold px-6 py-3 rounded-xl transition"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>

      </div>
    </MainLayout>
  );
}

export default Settings;