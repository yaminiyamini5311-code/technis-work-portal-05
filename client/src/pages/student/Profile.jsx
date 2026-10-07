import { useEffect, useState } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import "./StudentDashboard.css";
import "./Profile.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Profile() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({
    name: "",
    phone: ""
  });
  const [avatar, setAvatar] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await fetch(`${API_URL}/api/student/profile`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || "Unable to load profile");

      setUser(d.user);
      setForm({
        name: d.user.name || "",
        phone: d.user.phone || ""
      });
      setAvatarPreview(d.user.avatar || null);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setError("Only JPEG, PNG, and WebP images are allowed");
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      setError("File size must be less than 2MB");
      return;
    }

    setAvatar(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);

    try {
      const formData = new FormData();
      formData.append("name", form.name.trim());
      formData.append("phone", form.phone.trim());
      if (avatar) {
        formData.append("avatar", avatar);
      }

      const res = await fetch(`${API_URL}/api/student/profile`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: formData
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.message || "Unable to save profile");

      setMessage("Profile updated successfully");
      setAvatar(null);
      load();

      // Update local storage user
      const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
      localStorage.setItem("user", JSON.stringify({ ...storedUser, name: form.name.trim() }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="portal-loading"><div className="loader-dot" /><h2>Loading profile</h2><p>Fetching your information.</p></div>;

  return (
    <div className="student-dashboard-page page-enter">
      <div className="simple-head">
        <span>ACCOUNT</span>
        <h2>My Profile</h2>
        <p>View and edit your profile information.</p>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {message && <div className="success-msg">{message}</div>}

      <div className="profile-container">
        {/* Identity Card (Left) */}
        <div className="profile-identity-card">
          <div className="profile-avatar-wrapper">
            <div className="profile-avatar">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" />
              ) : (
                <span className="profile-avatar-initial">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </span>
              )}
            </div>
          </div>

          <h3 className="profile-name">{user?.name || 'User'}</h3>
          <p className="profile-email">{user?.email || ''}</p>
          <span className="profile-role-badge">{user?.role || 'Student'}</span>

          <div className="profile-upload-section">
            <label className="profile-upload-btn">
              <TechinsIcon name="upload" size={16} />
              {avatar ? 'Change Photo' : 'Upload Photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarChange}
                style={{ display: 'none' }}
              />
            </label>
            <small className="profile-upload-helper">JPEG, PNG, or WebP · Max 2MB</small>
          </div>
        </div>

        {/* Details Card (Right) */}
        <div className="profile-details-card">
          <p className="profile-details-eyebrow">PROFILE DETAILS</p>
          <h2 className="profile-details-heading">Your information</h2>

          <form onSubmit={save}>
            <div className="profile-form-grid">
              {/* Full Name */}
              <div className="profile-field-group">
                <label htmlFor="profile-name" className="profile-label">Full Name</label>
                <input
                  id="profile-name"
                  type="text"
                  className="profile-input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              {/* Phone Number */}
              <div className="profile-field-group">
                <label htmlFor="profile-phone" className="profile-label">Phone Number</label>
                <input
                  id="profile-phone"
                  type="tel"
                  className="profile-input"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 234 567 8900"
                />
              </div>

              {/* Email (Read-only) */}
              <div className="profile-field-group">
                <label htmlFor="profile-email" className="profile-label">
                  Email <span className="profile-label-suffix">(cannot be changed)</span>
                </label>
                <div className="profile-input-wrapper">
                  <input
                    id="profile-email"
                    type="email"
                    className="profile-input"
                    value={user?.email || ""}
                    disabled
                  />
                  <TechinsIcon name="lock" size={16} className="profile-lock-icon" />
                </div>
              </div>

              {/* Role (Read-only) */}
              <div className="profile-field-group">
                <label htmlFor="profile-role" className="profile-label">
                  Role <span className="profile-label-suffix">(cannot be changed)</span>
                </label>
                <div className="profile-input-wrapper">
                  <input
                    id="profile-role"
                    type="text"
                    className="profile-input"
                    value={user?.role || "Student"}
                    disabled
                    style={{ textTransform: 'capitalize' }}
                  />
                  <TechinsIcon name="lock" size={16} className="profile-lock-icon" />
                </div>
              </div>
            </div>

            <div className="profile-save-section">
              <button
                type="submit"
                disabled={saving}
                className="profile-save-btn"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
