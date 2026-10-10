import { useState } from "react";
import TechinsIcon from "./TechinsIcon";

/**
 * Reusable Password Input with Show/Hide Toggle
 * Features:
 * - Eye icon toggle to show/hide password
 * - Maintains focus when toggling
 * - Keyboard accessible (Tab, Enter/Space)
 * - Matches existing input styling
 * - Accessible aria-labels
 */
export default function PasswordInput({
  id,
  name,
  value,
  onChange,
  placeholder = "Enter password",
  autoComplete = "current-password",
  required = false,
  disabled = false,
  className = "",
}) {
  const [showPassword, setShowPassword] = useState(false);

  const togglePassword = () => {
    setShowPassword((prev) => !prev);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      togglePassword();
    }
  };

  return (
    <div className={`password-field ${className}`}>
      <input
        id={id}
        name={name}
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={togglePassword}
        onKeyDown={handleKeyDown}
        aria-label={showPassword ? "Hide password" : "Show password"}
        aria-pressed={showPassword}
        tabIndex={0}
      >
        <TechinsIcon
          name={showPassword ? "eyeOff" : "eye"}
          size={18}
          variant="light"
        />
      </button>
    </div>
  );
}
