import React from "react";
import { createRoot } from "react-dom/client";
import App from "./CareerWorkspace.tsx";
import "./style.css";
import "./career.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
