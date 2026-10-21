import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./styles/motion.css";
import "./styles/admin.css";
import "./styles/buttons.css";
import "./styles/theme.css";
import "./styles/3d-effects.css";

// Restore the persisted Femly accent (forest default) on startup, try/catch.
try {
  const stored = localStorage.getItem("femly-accent");
  if (stored && ["forest","ocean","plum","ember"].includes(stored)) {
    document.documentElement.dataset.accent = stored;
  }
} catch {} // eslint-disable-next-line no-empty

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
