import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";
import logo1 from "../assets/logo1.png";
import { IoIosEye, IoIosEyeOff } from "react-icons/io";
import { ClipLoader } from "react-spinners";
import { useDispatch } from "react-redux";
import { setUserData } from "../redux/userSlice";
import { apiUrl } from "../config/api";
import { setTabAuthToken } from "../utils/tabAuth";
import { resetThemeForPublicPages } from "../utils/theme";

const AUTH_BUTTON_CLASS =
  "w-[90%] h-[56px] bg-black text-white font-semibold rounded-2xl flex justify-center items-center hover:bg-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

function SignIn() {
  const navigate = useNavigate(); // only for signup / forgot links
  const dispatch = useDispatch();

  const [inputClicked, setInputClicked] = useState({
    userName: false,
    password: false,
  });

  const [showPassword, setShowPassword] = useState(false);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [toast, setToast] = useState({
    show: false,
    message: "",
    type: "",
  });

  useEffect(() => {
    resetThemeForPublicPages();

    const inputs = document.querySelectorAll("input");
    inputs.forEach((input) => {
      if (input.value) {
        setInputClicked((prev) => ({
          ...prev,
          [input.id]: true,
        }));
      }
    });
  }, []);

  const showToast = (message, type) => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: "", type: "" });
    }, 3000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
        const res = await fetch(apiUrl("/api/auth/signin"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password }),
      });

      const data = await res.json();

      if (res.ok) {
        showToast("Sign in successful!", "success");

        // 🔐 Auth state change ONLY
        const { authToken, ...safeUser } = data;
        setTabAuthToken(authToken);
        dispatch(setUserData(safeUser));
      } else {
        showToast(data.message || "Invalid credentials", "error");
      }
    } catch {
      showToast("Cannot reach backend. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vybe-auth-page w-full h-screen bg-gradient-to-b from-black to-gray-900 flex justify-center items-center">

      {/* TOAST */}
      {toast.show && (
        <div
          className={`fixed top-8 right-8 px-6 py-4 rounded-lg shadow-2xl z-50
            ${toast.type === "success" ? "bg-green-500" : "bg-red-500"} text-white`}
        >
          {toast.message}
        </div>
      )}

      <div className="vybe-auth-card flex w-[90%] lg:max-w-[60%] h-[500px] bg-white text-black rounded-2xl overflow-hidden border-2 border-black">

        {/* LEFT */}
        <div className="w-full lg:w-1/2 flex flex-col items-center p-6 gap-5">
          <div className="flex gap-2 items-center text-xl font-semibold mt-10">
            <span>Sign In to</span>
            <img src={logo} alt="logo" className="w-[70px]" />
          </div>

          <form
            onSubmit={handleSubmit}
            className="w-full flex flex-col items-center gap-5 mt-8"
          >
            {/* USERNAME OR EMAIL */}
            <div
              className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl px-4 flex items-center"
              onClick={() =>
                setInputClicked({ ...inputClicked, userName: true })
              }
            >
              <label
                className={`absolute left-4 bg-white px-1 text-gray-700 transition-all
                  ${
                    inputClicked.userName || login
                      ? "top-[-12px] text-sm"
                      : "top-[15px]"
                  }`}
              >
                Enter Username or Email
              </label>

              <input
                id="userName"
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                onFocus={() =>
                  setInputClicked({ ...inputClicked, userName: true })
                }
                onBlur={() =>
                  !login &&
                  setInputClicked({ ...inputClicked, userName: false })
                }
                className="w-full h-full outline-none bg-transparent text-black"
                autoComplete="username"
                required
              />
            </div>

            {/* PASSWORD */}
            <div
              className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl px-4 flex items-center"
              onClick={() =>
                setInputClicked({ ...inputClicked, password: true })
              }
            >
              <label
                className={`absolute left-4 bg-white px-1 text-gray-700 transition-all
                  ${
                    inputClicked.password || password
                      ? "top-[-12px] text-sm"
                      : "top-[15px]"
                  }`}
              >
                Enter Password
              </label>

              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() =>
                  setInputClicked({ ...inputClicked, password: true })
                }
                onBlur={() =>
                  !password &&
                  setInputClicked({ ...inputClicked, password: false })
                }
                className="w-full h-full outline-none bg-transparent text-black"
                required
                minLength={6}
              />

              {showPassword ? (
                <IoIosEyeOff
                  className="absolute right-4 cursor-pointer"
                  onClick={() => setShowPassword(false)}
                />
              ) : (
                <IoIosEye
                  className="absolute right-4 cursor-pointer"
                  onClick={() => setShowPassword(true)}
                />
              )}
            </div>

            <div
              className="cursor-pointer"
              onClick={() => navigate("/forgot-password")}
            >
              Forgot Password?
            </div>

            <button
              disabled={loading}
              className={AUTH_BUTTON_CLASS}
            >
              {loading ? <ClipLoader color="#fff" size={22} /> : "Sign In"}
            </button>
          </form>

          <p
            className="cursor-pointer"
            onClick={() => navigate("/signup")}
          >
            Don’t have an account?{" "}
            <span className="border-b-2 border-black">Sign Up</span>
          </p>
        </div>

        {/* RIGHT */}
        <div className="vybe-auth-brand hidden lg:flex w-1/2 bg-black text-white flex-col justify-center items-center">
          <img src={logo1} alt="" className="w-[40%]" />
          <p>Not Just A Platform, It's A VYBE</p>
        </div>
      </div>
    </div>
  );
}

export default SignIn;
