import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import TechinsIcon from "../components/TechinsIcon";
import "./Login.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9\s-]{7,15}$/;

export default function Register() {
  const navigate = useNavigate();
  const errorRef = useRef(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "student",
    phone: "",
    batchId: ""
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // After a successful signup that requires approval we swap the form for a
  // dedicated success panel — the student is never stranded on a message.
  const [submitted, setSubmitted] = useState(false);

  // Load active batches from the public API (id + name only).
  // Accepts {batches:[...]}, {data:[...]} or a bare array so backend
  // envelope changes cannot silently empty the dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBatchesLoading(true);
        const { data } = await axios.get(`${API_URL}/api/batches`);
        if (cancelled) return;
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.batches)
            ? data.batches
            : Array.isArray(data?.data)
              ? data.data
              : [];
        setBatches(list.filter((b) => b && (b.id || b._id) && (b.name || b.batch_name)));
        setBatchesError("");
      } catch (err) {
        if (!cancelled) setBatchesError(err.response?.data?.message || "Unable to load batches. Please try again.");
      } finally {
        if (!cancelled) setBatchesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryBatches = async () => {
    try {
      setBatchesLoading(true);
      const { data } = await axios.get(`${API_URL}/api/batches`);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.batches)
          ? data.batches
          : Array.isArray(data?.data)
            ? data.data
            : [];
      setBatches(list.filter((b) => b && (b.id || b._id) && (b.name || b.batch_name)));
      setBatchesError("");
    } catch (err) {
      setBatchesError(err.response?.data?.message || "Unable to load batches. Please try again.");
    } finally {
      setBatchesLoading(false);
    }
  };

  // Scroll error into view when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [error]);

  const validateForm = () => {
    if (!form.name.trim()) return "Name is required";
    if (!form.email.trim()) return "Email is required";
    if (!EMAIL_RE.test(form.email.trim())) return "Enter a valid email address";
    if (!form.password) return "Password is required";
    if (form.password.length < 8) return "Password must be at least 8 characters";
    if (form.password !== form.confirmPassword) return "Passwords do not match";
    if (form.role === "student" && !form.phone.trim()) return "Phone number is required for students";
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) return "Enter a valid mobile number (7-15 digits)";
    if (form.role === "student" && !form.batchId) return "Batch selection is required";
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
      const { data } = await axios.post(`${API_URL}/api/auth/signup`, {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
        phone: form.phone.trim() || null,
        batchId: form.role === "student" ? form.batchId : undefined
      });

      if (data.success) {
        if (data.requiresApproval) {
          // Pending approval: dedicated success panel with a working next
          // step (sign in once approved) — never stranded on a message.
          setSubmitted(true);
        } else {
          navigate("/login", { replace: true });
        }
      }
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || "Unable to create account. Please try again.";
      if (status === 409) {
        // Account already exists — route to login instead of leaving the
        // user stuck on an error (and never create a duplicate account).
        navigate("/login", { replace: true, state: { notice: `${message} Please sign in instead.` } });
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Success panel — shown after a pending-approval signup.
  if (submitted) {
    return (
      <main className="login-page">
        <section className="login-section" aria-label="TECHINS workspace registration submitted">
          <div className="login-card">
            <div className="login-brand">
              <img src="/techins-logo-full.jpg" alt="TECHINS logo" />
              <span>ACCOUNT CREATED</span>
            </div>
            <div className="login-heading">
              <h2>You're all set</h2>
              <p>Your TECHINS workspace account has been created.</p>
            </div>
            <div className="login-success" role="status">
              Your registration is <strong>awaiting CEO approval</strong>. You can sign in as soon as an
              administrator approves your account — the Student Portal unlocks automatically.
            </div>
            <button className="login-submit" type="button" onClick={() => navigate("/login", { replace: true })}>
              Go to login <span aria-hidden="true">→</span>
            </button>
            <div className="login-footer-line">
              <span />
              <small>Already approved? <Link to="/login" style={{ color: '#FA9A02', textDecoration: 'none', fontWeight: '700' }}>Sign in</Link></small>
              <span />
            </div>
          </div>
        </section>
      </main>
    );
  }

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

          {error && (
            <div ref={errorRef} className="login-error login-error-prominent" role="alert">
              {error}
            </div>
          )}

          {/* noValidate: the form uses the shared validation below so every
              message renders in the styled, readable error box (and is
              identical to the server rules) instead of a native tooltip. */}
          <form onSubmit={submit} noValidate>
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
              onChange={(e) => setForm({ ...form, role: e.target.value, batchId: e.target.value === "student" ? form.batchId : "" })}
              required
            >
              <option value="student">Student</option>
              <option value="manager">Manager</option>
            </select>

            {form.role === "student" && (
              <>
                <label htmlFor="register-batch">Batch (required for students)</label>
                <select
                  id="register-batch"
                  value={form.batchId}
                  onChange={(e) => setForm({ ...form, batchId: e.target.value })}
                  disabled={batchesLoading}
                  required
                  aria-describedby="register-batch-help"
                  aria-busy={batchesLoading}
                >
                  <option value="">{batchesLoading ? "Loading batches..." : "Select a batch"}</option>
                  {batches.map((b) => {
                    const id = b.id || b._id;
                    const name = b.name || b.batch_name;
                    return (
                      <option key={String(id)} value={String(id)}>{name}</option>
                    );
                  })}
                </select>
                <small id="register-batch-help" className="field-hint">
                  {batchesLoading
                    ? "Loading available batches…"
                    : batchesError
                      ? "Batch list failed to load. "
                      : batches.length
                        ? `${batches.length} batch(es) available`
                        : "No batches available. Contact your administrator."}
                  {batchesError && !batchesLoading && (
                    <button type="button" className="link-button" onClick={retryBatches}>Retry</button>
                  )}
                </small>
                {batchesError && <small className="field-error" role="alert">{batchesError}</small>}
                {!batchesLoading && !batchesError && batches.length === 0 && (
                  <small className="field-error">No batches available. Contact your administrator.</small>
                )}
              </>
            )}

            <label htmlFor="register-password">Password</label>
            <div className="password-field">
              <input
                id="register-password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 8 characters"
                autoComplete="new-password"
                required
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
                <TechinsIcon name={showPassword ? "eye" : "eyeOff"} size={18} variant="dark" ariaHidden />
              </button>
            </div>

            <label htmlFor="register-confirm">Confirm password</label>
            <div className="password-field">
              <input
                id="register-confirm"
                type={showConfirm ? "text" : "password"}
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder="Re-enter password"
                autoComplete="new-password"
                required
              />
              <button type="button" className="password-toggle" onClick={() => setShowConfirm((v) => !v)} aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"} title={showConfirm ? "Hide confirm password" : "Show confirm password"}>
                <TechinsIcon name={showConfirm ? "eye" : "eyeOff"} size={18} variant="dark" ariaHidden />
              </button>
            </div>

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
