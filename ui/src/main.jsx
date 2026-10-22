import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { applyTheme, loadTheme } from "./theme.js";

applyTheme(loadTheme());

createRoot(document.getElementById("root")).render(<App />);
