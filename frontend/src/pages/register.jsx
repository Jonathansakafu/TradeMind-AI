import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { API_URL } from "../config/api";

function Register() {

  const navigate = useNavigate();

  const [username, setUsername] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState(null);

  const handleRegister = async () => {

    if (!username || !email || !password) {
      setMessage({ type: "error", text: "Please fill all fields" });
      return;
    }

    setLoading(true);
    setMessage({ type: "info", text: "Creating account — first request after inactivity can take up to a minute..." });

    try {

      const res = await axios.post(
        `${API_URL}/api/auth/register`,
        {
          username,
          email,
          password,
        }
      );

      // SAVE TOKEN
      localStorage.setItem(
        "token",
        res.data.token
      );

      // SAVE USER
      localStorage.setItem(
        "user",
        JSON.stringify(res.data.user)
      );

      setMessage({ type: "success", text: "Account created successfully" });

      navigate("/dashboard");

    } catch (error) {

      setMessage({
        type: "error",
        text: error.response?.data?.message || "Registration failed",
      });

    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">

      <div className="bg-slate-900 p-10 rounded-2xl w-full max-w-md shadow-xl">

        <h1 className="text-4xl font-bold text-center text-green-400 mb-8">
          TradeMind AI
        </h1>

        <h2 className="text-2xl font-semibold mb-6 text-center">
          Register
        </h2>

        <div className="space-y-4">

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) =>
              setUsername(e.target.value)
            }
            className="w-full bg-slate-800 p-4 rounded-xl outline-none"
          />

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            className="w-full bg-slate-800 p-4 rounded-xl outline-none"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            className="w-full bg-slate-800 p-4 rounded-xl outline-none"
          />

          {message && (
            <div
              className={`text-sm rounded-xl p-3 ${
                message.type === "error"
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : message.type === "success"
                  ? "bg-green-500/10 text-green-400 border border-green-500/20"
                  : "bg-slate-800 text-slate-300 border border-slate-700"
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            onClick={handleRegister}
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 p-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
          >
            {loading
              ? <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              : "Create Account"
            }
          </button>

        </div>

        <p className="text-slate-400 mt-6 text-center">

          Already have an account?{" "}

          <Link
            to="/"
            className="text-green-400"
          >
            Login
          </Link>

        </p>

      </div>

    </div>
  );
}

export default Register;