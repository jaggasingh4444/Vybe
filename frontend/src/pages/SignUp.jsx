import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";
import logo1 from "../assets/logo1.png";
import { IoIosEye, IoIosEyeOff } from "react-icons/io";
import { ClipLoader } from "react-spinners";
import { apiUrl } from "../config/api";
import { resetThemeForPublicPages } from "../utils/theme";

function SignUp() {
  const navigate = useNavigate();

  const [inputClicked, setInputClicked] = useState({
    name: false,
    userName: false,
    email: false,
    otp: false,
    password: false,
  });

  const [showPassword, setShowPassword] = useState(false);

  const [name, setName] = useState("");
  const [userName, setUserName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

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

    if (!emailVerified) {
      showToast("Please verify your email first", "error");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(apiUrl("/api/auth/signup"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          userName,
          email,
          password,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        showToast("User registered successfully!", "success");

        // ⏳ WAIT so toast is visible
        setTimeout(() => {
          navigate("/signin");
        }, 1500);

        // clear form
        setName("");
        setUserName("");
        setEmail("");
        setOtp("");
        setOtpSent(false);
        setEmailVerified(false);
        setPassword("");

        setInputClicked({
          name: false,
          userName: false,
          email: false,
          otp: false,
          password: false,
        });
      } else {
        showToast(data.message || "Signup failed", "error");
      }
    } catch {
      showToast("Server error. Try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailChange = (nextEmail) => {
    setEmail(nextEmail);
    setOtp("");
    setOtpSent(false);
    setEmailVerified(false);
    setInputClicked((current) => ({ ...current, email: Boolean(nextEmail), otp: false }));
  };

  const handleSendOtp = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      showToast("Please enter your email", "error");
      return;
    }

    setOtpLoading(true);

    try {
      const res = await fetch(apiUrl("/api/auth/signup/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Failed to send code");

      setOtpSent(true);
      setEmailVerified(false);
      setInputClicked((current) => ({ ...current, otp: true }));
      showToast(data.message || "Verification code sent", "success");
    } catch (error) {
      showToast(error.message || "Failed to send code", "error");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim()) {
      showToast("Please enter the verification code", "error");
      return;
    }

    setVerifyLoading(true);

    try {
      const res = await fetch(apiUrl("/api/auth/signup/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), otp: otp.trim() }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Verification failed");

      setEmailVerified(true);
      showToast(data.message || "Email verified", "success");
    } catch (error) {
      setEmailVerified(false);
      showToast(error.message || "Verification failed", "error");
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="w-full h-screen bg-gradient-to-b from-black to-gray-900 flex justify-center items-center">
      
      {/* TOAST */}
      {toast.show && (
        <div
          className={`fixed top-8 right-8 px-6 py-4 rounded-lg shadow-xl z-50
            ${toast.type === "success" ? "bg-green-500" : "bg-red-500"} text-white`}
        >
          {toast.message}
        </div>
      )}

      <div className="flex w-[90%] lg:max-w-[60%] min-h-[650px] bg-white text-black rounded-2xl overflow-hidden border-2 border-black">

        {/* LEFT */}
        <div className="w-full lg:w-1/2 flex flex-col items-center p-6 gap-5">
          <div className="flex gap-2 items-center text-xl font-semibold mt-10">
            <span>Sign Up to</span>
            <img src={logo} alt="logo" className="w-[70px]" />
          </div>

          <form onSubmit={handleSubmit} className="w-full flex flex-col items-center gap-5">

            {/* NAME */}
            <Input
              label="Enter Your Name"
              id="name"
              value={name}
              setValue={setName}
              inputClicked={inputClicked}
              setInputClicked={setInputClicked}
            />

            {/* USERNAME */}
            <Input
              label="Enter Username"
              id="userName"
              value={userName}
              setValue={setUserName}
              inputClicked={inputClicked}
              setInputClicked={setInputClicked}
            />

            {/* EMAIL */}
            <Input
              label="Enter Your Email"
              id="email"
              type="email"
              value={email}
              setValue={handleEmailChange}
              inputClicked={inputClicked}
              setInputClicked={setInputClicked}
              disabled={emailVerified}
            />

            <div className="w-[90%] flex items-center gap-2">
              {otpSent && !emailVerified ? (
                <div
                  className="relative h-[48px] flex-1 border-2 border-black rounded-2xl px-4 flex items-center"
                  onClick={() => setInputClicked({ ...inputClicked, otp: true })}
                >
                  <label
                    className={`absolute left-4 bg-white px-1 text-gray-700 transition-all
                      ${inputClicked.otp || otp ? "top-[-12px] text-sm" : "top-[12px]"}`}
                  >
                    Verification Code
                  </label>
                  <input
                    type="text"
                    value={otp}
                    maxLength={6}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                    className="w-full h-full outline-none bg-transparent text-black"
                    required
                  />
                </div>
              ) : null}

              {emailVerified ? (
                <div className="w-full h-[44px] rounded-2xl bg-green-100 text-green-700 font-semibold flex items-center justify-center">
                  Email verified
                </div>
              ) : otpSent ? (
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={verifyLoading}
                  className="h-[48px] min-w-[105px] rounded-2xl bg-black text-white font-semibold flex items-center justify-center disabled:opacity-60"
                >
                  {verifyLoading ? <ClipLoader color="#fff" size={18} /> : "Verify"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={otpLoading}
                  className="w-full h-[44px] rounded-2xl bg-[#111] text-white font-semibold flex items-center justify-center disabled:opacity-60"
                >
                  {otpLoading ? <ClipLoader color="#fff" size={18} /> : "Send email code"}
                </button>
              )}
            </div>

            {otpSent && !emailVerified ? (
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={otpLoading}
                className="text-sm text-gray-700 border-b border-black disabled:opacity-60"
              >
                {otpLoading ? "Sending..." : "Resend code"}
              </button>
            ) : null}

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
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

            <button
              disabled={loading || !emailVerified}
              className="w-[70%] h-[50px] bg-black text-white rounded-2xl flex justify-center items-center disabled:opacity-50"
            >
              {loading ? <ClipLoader color="#fff" size={22} /> : "Sign Up"}
            </button>
          </form>

          <p
            className="cursor-pointer"
            onClick={() => navigate("/signin")}
          >
            Already have an account?{" "}
            <span className="border-b-2 border-black">Sign In</span>
          </p>
        </div>

        {/* RIGHT */}
        <div className="hidden lg:flex w-1/2 bg-black text-white flex-col justify-center items-center">
          <img src={logo1} alt="" className="w-[40%]" />
          <p>Not Just A Platform, It's A VYBE</p>
        </div>
      </div>
    </div>
  );
}

export default SignUp;

/* ---------- Reusable Input Component ---------- */

function Input({
  label,
  id,
  value,
  setValue,
  inputClicked,
  setInputClicked,
  type = "text",
  disabled = false,
}) {
  return (
    <div
      className={`relative w-[90%] h-[55px] border-2 border-black rounded-2xl px-4 flex items-center ${
        disabled ? "bg-gray-100" : "bg-white"
      }`}
      onClick={() => setInputClicked({ ...inputClicked, [id]: true })}
    >
      <label
        className={`absolute left-4 bg-white px-1 text-gray-700 transition-all
          ${
            inputClicked[id] || value
              ? "top-[-12px] text-sm"
              : "top-[15px]"
          }`}
      >
        {label}
      </label>

      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="w-full h-full outline-none bg-transparent text-black"
        required
      />
    </div>
  );
}
