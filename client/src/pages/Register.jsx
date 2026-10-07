import { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import "./Login.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "student",
    phone: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validateForm = () => {
    if (!form.name.trim()) return "Name is required";
    if (!form.email.trim()) return "Email is required";
    if (!form.password) return "Password is required";
    if (form.password.length < 8) return "Password must be at least 8 characters";
    if (form.password !== form.confirmPassword) return "Passwords do not match";
    if (form.role === "student" && !form.phone.trim()) return "Phone number is required for students";
    return null;
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      const { data } = await axios.post(`${API_URL}/api/auth/register`, {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
        phone: form.phone.trim() || null
      });

      if (data.success) {
        if (data.message.includes("pending")) {
          setError(data.message);
        } else {
          navigate("/login", { replace: true });
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || "Unable to create account. Please try again.");
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
            <span className="hero-eyebrow">JOIN THE TEAM</span>
            <h1>
              Create Your<br />
              <em>Account.</em>
            </h1>
            <p>
              Sign up to access your TECHINS workspace and start your journey.
            </p>
          </div>

          <div className="hero-features" aria-label="Portal features">
            <span><b>01</b> Focused work</span>
            <span><b>02</b> Live progress</span>
            <span><b>03</b> Team visibility</span>
          </div>
        </div>
      </section>

      <section className="login-section" aria-label="TECHINS workspace registration">
        <div className="login-card">
          <div className="login-brand">
            <img src="/techins-logo-full.jpg" alt="TECHINS logo" />
            <span>CREATE ACCOUNT</span>
          </div>

          <div className="login-heading">
            <h2>Sign up</h2>
            <p>Create your TECHINS workspace account.</p>
          </div>

          <form onSubmit={submit}>
            <label htmlFor="register-name">Full name</label>
            <input
              id="register-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="John Doe"
              autoComplete="name"
              required
            />

            <label htmlFor="register-email">Email address</label>
            <input
              id="register-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@techins.com"
              autoComplete="email"
              required
            />

            <label htmlFor="register-phone">Phone number (students only)</label>
            <input
              id="register-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+1 234 567 8900"
              autoComplete="tel"
            />

            <label htmlFor="register-role">Role</label>
            <select
              id="register-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              required
            >
              <option value="student">Student</option>
              <option value="manager">Manager</option>
              <option value="ceo">CEO</option>
            </select>

            <label htmlFor="register-password">Password</label>
            <div className="password-field">
              <input
                id="register-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 8 characters"
                autoComplete="new-password"
                required
              />
            </div>

            <label htmlFor="register-confirm">Confirm password</label>
            <div className="password-field">
              <input
                id="register-confirm"
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder="Re-enter password"
                autoComplete="new-password"
                required
              />
            </div>

            {error && <div className="login-error" role="alert">{error}</div>}

            <button className="login-submit" disabled={loading} type="submit">
              {loading ? <span className="button-loader" /> : <>Create Account <span aria-hidden="true">→</span></>}
            </button>
          </form>

          <div className="login-footer-line">
            <span />
            <small>Already have an account? <Link to="/login" style={{ color: '#FA9A02', textDecoration: 'none', fontWeight: '700' }}>Sign in</Link></small>
            <span />
          </div>
        </div>
      </section>
    </main>
  );
}
