
import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

import SignUp from "./pages/SignUp";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import ForgotPassword from "./pages/ForgotPassword";
import logo from "./assets/logo.png";

import useGetCurrentUser from "./hooks/getCurrentUser";
import useGetSuggestedUsers from "./hooks/getSuggestedUsers";
import { applyTheme, getStoredTheme } from "./utils/theme";

function App() {
  // 🔥 Runs once on refresh, restores auth from cookie
  const loadingUser = useGetCurrentUser();

  const { userData, isAuthChecked } = useSelector((state) => state.user);

  // 🔥 Always call (but internally guarded)
  useGetSuggestedUsers(userData);

  useEffect(() => {
    if (!isAuthChecked) return;

    if (userData) {
      applyTheme(getStoredTheme(), true);
      return;
    }

    applyTheme("dark", false);
  }, [isAuthChecked, userData]);

  // ⏳ Wait until auth check finishes
  if (loadingUser || !isAuthChecked) {
    return (
      <div className="vybe-auth-loading-screen">
        <div className="vybe-auth-loading-card" aria-label="Loading VYBE">
          <span className="vybe-auth-loading-ring" />
          <img src={logo} alt="VYBE" className="vybe-auth-loading-logo" />
          <span className="vybe-auth-loading-dot" />
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* PUBLIC ROUTES */}
        <Route
          path="/signup"
          element={!userData ? <SignUp /> : <Navigate to="/" replace />}
        />

        <Route
          path="/signin"
          element={!userData ? <SignIn /> : <Navigate to="/" replace />}
        />

        <Route
          path="/forgot-password"
          element={!userData ? <ForgotPassword /> : <Navigate to="/" replace />}
        />

        {/* PROTECTED ROUTE */}
        <Route
          path="/"
          element={
            isAuthChecked
              ? userData
                ? <Home />
                : <Navigate to="/signin" replace />
              : null
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
