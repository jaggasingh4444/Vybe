import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IoIosEye, IoIosEyeOff } from "react-icons/io";
import { ClipLoader } from "react-spinners";
import logo from "../assets/logo.png";
import logo1 from "../assets/logo1.png";
import { apiUrl } from "../config/api";
import {
  EMAIL_VALIDATION_MESSAGE,
  isValidEmailAddress,
  normalizeEmailInput,
} from "../utils/emailValidation";
import { resetThemeForPublicPages } from "../utils/theme";

const AUTH_BUTTON_CLASS =
  "w-[90%] h-[56px] bg-black text-white font-semibold rounded-2xl flex justify-center items-center hover:bg-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

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
  }, []);

  const showToast = (message, type) => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: "", type: "" });
    }, 3000);
  };

  const clearForm = () => {
    setName("");
    setUserName("");
    setEmail("");
    setOtp("");
    setOtpSent(false);
    setPassword("");
    setInputClicked({
      name: false,
      userName: false,
      email: false,
      otp: false,
      password: false,
    });
  };

  const validateDetails = () => {
    if (!name.trim() || !userName.trim() || !email.trim() || !password.trim()) {
      showToast("Please fill all signup details first", "error");
      return false;
    }

    if (!isValidEmailAddress(email)) {
      showToast(EMAIL_VALIDATION_MESSAGE, "error");
      return false;
    }

    if (password.length < 6) {
      showToast("Password must be at least 6 characters", "error");
      return false;
    }

    return true;
  };

  const sendSignupCode = async () => {
    if (!validateDetails()) return false;

    const normalizedEmail = normalizeEmailInput(email);
    setOtpLoading(true);

    try {
      const res = await fetch(apiUrl("/api/auth/signup/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Failed to send code");

      setOtp("");
      setOtpSent(true);
      setInputClicked((current) => ({ ...current, otp: true }));
      showToast(data.message || "Verification code sent", "success");
      return true;
    } catch (error) {
      showToast(error.message || "Failed to send code", "error");
      return false;
    } finally {
      setOtpLoading(false);
    }
  };

  const createAccount = async () => {
    setLoading(true);
    const normalizedEmail = normalizeEmailInput(email);

    try {
      const res = await fetch(apiUrl("/api/auth/signup"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          userName: userName.trim(),
          email: normalizedEmail,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Signup failed");

      showToast("Account created. Please sign in.", "success");

      setTimeout(() => {
        clearForm();
        navigate("/signin");
      }, 1200);
    } catch (error) {
      showToast(error.message || "Server error. Try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!otpSent) {
      await sendSignupCode();
      return;
    }

    if (otp.trim().length < 6) {
      showToast("Please enter the 6-digit code", "error");
      return;
    }

    setVerifyLoading(true);
    const normalizedEmail = normalizeEmailInput(email);

    try {
      const res = await fetch(apiUrl("/api/auth/signup/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, otp: otp.trim() }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Verification failed");

      await createAccount();
    } catch (error) {
      showToast(error.message || "Verification failed", "error");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleEditDetails = () => {
    setOtp("");
    setOtpSent(false);
    setInputClicked((current) => ({ ...current, otp: false }));
  };

  const detailsComplete =
    name.trim() && userName.trim() && email.trim() && password.trim().length >= 6;
  const actionLoading = otpLoading || verifyLoading || loading;
  const actionDisabled =
    actionLoading || (!otpSent && !detailsComplete) || (otpSent && otp.trim().length < 6);

  return (
    <div className="vybe-auth-page w-full h-screen bg-gradient-to-b from-black to-gray-900 flex justify-center items-center">
      {toast.show && (
        <div
          className={`fixed top-8 right-8 px-6 py-4 rounded-lg shadow-xl z-50 ${
            toast.type === "success" ? "bg-green-500" : "bg-red-500"
          } text-white`}
        >
          {toast.message}
        </div>
      )}

      <div className="vybe-auth-card flex w-[90%] lg:max-w-[60%] min-h-[650px] bg-white text-black rounded-2xl overflow-hidden border-2 border-black">
        <div className="w-full lg:w-1/2 flex flex-col items-center p-6 gap-5">
          <div className="flex gap-2 items-center text-xl font-semibold mt-10">
            <span>{otpSent ? "Verify" : "Sign Up to"}</span>
            <img src={logo} alt="logo" className="w-[70px]" />
          </div>

          <p className="w-[90%] text-center text-sm text-gray-600 min-h-[20px]">
            {otpSent
              ? `Enter the code sent to ${email.trim()}`
              : "Fill your details first, then we will send your email code."}
          </p>

          <form onSubmit={handleSubmit} noValidate className="w-full flex flex-col items-center gap-5">
            {!otpSent ? (
              <>
                <Input
                  label="Enter Your Name"
                  id="name"
                  value={name}
                  setValue={setName}
                  inputClicked={inputClicked}
                  setInputClicked={setInputClicked}
                />

                <Input
                  label="Enter Username"
                  id="userName"
                  value={userName}
                  setValue={setUserName}
                  inputClicked={inputClicked}
                  setInputClicked={setInputClicked}
                />

                <Input
                  label="Enter Your Email"
                  id="email"
                  type="email"
                  value={email}
                  setValue={setEmail}
                  inputClicked={inputClicked}
                  setInputClicked={setInputClicked}
                />

                <PasswordInput
                  password={password}
                  setPassword={setPassword}
                  showPassword={showPassword}
                  setShowPassword={setShowPassword}
                  inputClicked={inputClicked}
                  setInputClicked={setInputClicked}
                />
              </>
            ) : (
              <>
                <div className="w-[90%] rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  Code sent to <span className="font-semibold text-black">{email.trim()}</span>
                </div>

                <Input
                  label="Enter Verification Code"
                  id="otp"
                  type="text"
                  value={otp}
                  setValue={(nextOtp) => setOtp(nextOtp.replace(/\D/g, "").slice(0, 6))}
                  inputClicked={inputClicked}
                  setInputClicked={setInputClicked}
                />

                <div className="w-[90%] flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={handleEditDetails}
                    className="font-semibold text-gray-700 border-b border-gray-700"
                  >
                    Edit details
                  </button>

                  <button
                    type="button"
                    onClick={sendSignupCode}
                    disabled={otpLoading}
                    className="font-semibold text-gray-700 border-b border-gray-700 disabled:opacity-50"
                  >
                    {otpLoading ? "Sending..." : "Resend code"}
                  </button>
                </div>
              </>
            )}

            <button type="submit" disabled={actionDisabled} className={AUTH_BUTTON_CLASS}>
              {actionLoading ? (
                <ClipLoader color="#fff" size={22} />
              ) : otpSent ? (
                "Verify & Sign Up"
              ) : (
                "Send email code"
              )}
            </button>
          </form>

          <p className="cursor-pointer" onClick={() => navigate("/signin")}>
            Already have an account? <span className="border-b-2 border-black">Sign In</span>
          </p>
        </div>

        <div className="vybe-auth-brand hidden lg:flex w-1/2 bg-black text-white flex-col justify-center items-center">
          <img src={logo1} alt="" className="w-[40%]" />
          <p>Not Just A Platform, It's A VYBE</p>
        </div>
      </div>
    </div>
  );
}

export default SignUp;

function Input({
  label,
  id,
  value,
  setValue,
  inputClicked,
  setInputClicked,
  type = "text",
}) {
  return (
    <div
      className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl px-4 flex items-center bg-white"
      onClick={() => setInputClicked({ ...inputClicked, [id]: true })}
    >
      <label
        className={`absolute left-4 bg-white px-1 text-gray-700 transition-all ${
          inputClicked[id] || value ? "top-[-12px] text-sm" : "top-[15px]"
        }`}
      >
        {label}
      </label>

      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setInputClicked({ ...inputClicked, [id]: true })}
        onBlur={() => !value && setInputClicked({ ...inputClicked, [id]: false })}
        className="w-full h-full outline-none bg-transparent text-black"
        required
      />
    </div>
  );
}

function PasswordInput({
  password,
  setPassword,
  showPassword,
  setShowPassword,
  inputClicked,
  setInputClicked,
}) {
  return (
    <div
      className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl px-4 flex items-center"
      onClick={() => setInputClicked({ ...inputClicked, password: true })}
    >
      <label
        className={`absolute left-4 bg-white px-1 text-gray-700 transition-all ${
          inputClicked.password || password ? "top-[-12px] text-sm" : "top-[15px]"
        }`}
      >
        Enter Password
      </label>

      <input
        id="password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onFocus={() => setInputClicked({ ...inputClicked, password: true })}
        onBlur={() => !password && setInputClicked({ ...inputClicked, password: false })}
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
  );
}
