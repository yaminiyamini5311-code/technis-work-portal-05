import { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import "./Login.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      setLoading(true);
      const { data } = await axios.post(`${API_URL}/api/auth/login`, {
        email: email.trim().toLowerCase(),
        password,
      });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("role", data.user.role);
      navigate(
        data.user.role === "admin"
          ? "/admin"
          : data.user.role === "manager"
            ? "/manager"
            : "/student",
        { replace: true }
      );
    } catch (err) {
      setError(err.response?.data?.message || "Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-hero" aria-label="TECHINS Work Portal">
        <div className="hero-grid" />
        <div className="hero-content">
          <div className="hero-brand">
            <img src="/techins-logo-full.jpg" alt="TECHINS" />
            <div>
              <strong>TECHINS</strong>
              <span>WORK PORTAL</span>
            </div>
          </div>

          <div className="hero-copy">
            <span className="hero-eyebrow">PRIVATE TEAM WORKSPACE</span>
            <h1>
              Where Learning<br />
              <em>Becomes Ideas.</em>
            </h1>
            <p>
              One focused space for tasks, missions, daily work, reports and measurable progress.
            </p>
          </div>

          <div className="hero-features" aria-label="Portal features">
            <span><b>01</b> Focused work</span>
            <span><b>02</b> Live progress</span>
            <span><b>03</b> Team visibility</span>
          </div>
        </div>
      </section>

      <section className="login-section" aria-label="TECHINS secure workspace login">
        <div className="login-card">
          <div className="login-brand">
            <img src="/techins-logo-full.jpg" alt="TECHINS logo" />
            <span>SECURE WORKSPACE</span>
          </div>

          <div className="login-heading">
            <h2>Welcome back</h2>
            <p>Sign in to continue to your TECHINS workspace.</p>
          </div>

          <form onSubmit={submit}>
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@techins.com"
              autoComplete="username"
              required
            />

            <label htmlFor="login-password">Password</label>
            <div className="password-field">
              <input
                id="login-password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? "Hide" : "Show"}
              </button>
            </div>

            {error && <div className="login-error" role="alert">{error}</div>}

            <button className="login-submit" disabled={loading} type="submit">
              {loading ? <span className="button-loader" /> : <>Sign in <span aria-hidden="true">→</span></>}
            </button>
          </form>

          <div className="login-footer-line">
            <span />
            <small>New to TECHINS? <Link to="/register" style={{ color: '#FA9A02', textDecoration: 'none', fontWeight: '700' }}>Create an account</Link></small>
            <span />
          </div>
        </div>
      </section>
    </main>
  );
}
