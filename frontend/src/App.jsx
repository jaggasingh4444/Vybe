
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

import SignUp from "./pages/SignUp";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import ForgotPassword from "./pages/ForgotPassword";

import useGetCurrentUser from "./hooks/getCurrentUser";
import useGetSuggestedUsers from "./hooks/getSuggestedUsers";

function App() {
  // 🔥 Runs once on refresh, restores auth from cookie
  const loadingUser = useGetCurrentUser();

  const { userData, isAuthChecked } = useSelector((state) => state.user);

  // 🔥 Always call (but internally guarded)
  useGetSuggestedUsers(userData);

  // ⏳ Wait until auth check finishes
  if (loadingUser || !isAuthChecked) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-black">
        <p className="text-white text-xl">Checking authentication...</p>
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
