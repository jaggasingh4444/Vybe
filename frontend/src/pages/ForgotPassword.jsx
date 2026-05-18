import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipLoader } from 'react-spinners'
import { IoIosEye, IoIosEyeOff } from "react-icons/io"
import axios from 'axios'
import { apiUrl } from '../config/api'

function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  
  // Input focus states
  const [inputClicked, setInputClicked] = useState({
    email: false,
    otp: false,
    newPassword: false,
    confirmPassword: false
  })
  
  // Form states
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  
  // Show/hide password
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  
  // Toast notification
  const [toast, setToast] = useState({ show: false, message: "", type: "" })
  
  const showToast = (message, type) => {
    setToast({ show: true, message, type })
    setTimeout(() => {
      setToast({ show: false, message: "", type: "" })
    }, 3000)
  }
  
  // Step 1: Send OTP to email
  const handleStep1 = async (e) => {
    if (e) e.preventDefault()
    
    if (!email) {
      showToast("Please enter your email", "error")
      return
    }
    
    setLoading(true)
    
    try {
      const res = await axios.post(apiUrl("/api/auth/sendOtp"), { email })
      showToast(res.data.message || "OTP sent successfully!", "success")
      setTimeout(() => setStep(2), 1500)
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to send OTP", "error")
    } finally {
      setLoading(false)
    }
  }
  
  // Step 2: Verify OTP
  const handleStep2 = async (e) => {
    if (e) e.preventDefault()
    
    if (!otp) {
      showToast("Please enter the OTP", "error")
      return
    }
    
    setLoading(true)
    
    try {
      const res = await axios.post(apiUrl("/api/auth/verifyOtp"), { email, otp })
      showToast(res.data.message || "OTP verified successfully!", "success")
      setTimeout(() => setStep(3), 1500)
    } catch (error) {
      showToast(error.response?.data?.message || "Invalid OTP", "error")
    } finally {
      setLoading(false)
    }
  }
  
  // Step 3: Reset Password
  const handleStep3 = async (e) => {
    if (e) e.preventDefault()
    
    if (newPassword !== confirmPassword) {
      showToast("Passwords do not match!", "error")
      return
    }
    
    if (newPassword.length < 6) {
      showToast("Password must be at least 6 characters", "error")
      return
    }
    
    setLoading(true)
    
    try {
      const res = await axios.post(apiUrl("/api/auth/resetPassword"), { email, password: newPassword })
      showToast(res.data.message || "Password reset successful!", "success")
      setTimeout(() => navigate("/signin"), 2000)
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to reset password", "error")
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className='w-full h-screen bg-gradient-to-b from-black to-gray-900 flex flex-col justify-center items-center'>
      {/* TOAST NOTIFICATION */}
      {toast.show && (
        <div
          className={`fixed top-8 right-8 px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 z-50 animate-slide-in ${
            toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
          }`}
        >
          {toast.type === "success" ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <span className="font-semibold text-[15px]">{toast.message}</span>
        </div>
      )}

      {/* STEP 1: Enter Email */}
      {step === 1 && (
        <div className='w-[90%] max-w-[500px] h-[450px] bg-white rounded-2xl flex justify-center items-center flex-col border-2 border-[#1a1f23] gap-5 p-6'>
          <h2 className='text-2xl font-bold'>Forgot Password</h2>
          <p className='text-gray-600 text-sm text-center'>Enter your email address and we'll send you an OTP</p>
          
          <form onSubmit={handleStep1} className='w-full flex flex-col items-center gap-5'>
            {/* EMAIL FIELD */}
            <div
              className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl flex items-center px-4 cursor-text transition-all"
              onClick={() => setInputClicked({ ...inputClicked, email: true })}
            >
              <label
                htmlFor="email"
                className={`absolute left-4 px-1 bg-white text-gray-600 transition-all pointer-events-none
                  ${inputClicked.email || email ? "top-[-12px] text-[13px]" : "top-[15px] text-[15px]"}`}
              >
                Enter Your Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (e.target.value) {
                    setInputClicked({ ...inputClicked, email: true })
                  }
                }}
                onFocus={() => setInputClicked({ ...inputClicked, email: true })}
                onBlur={() => !email && setInputClicked({ ...inputClicked, email: false })}
                className="w-full h-full outline-none border-0 bg-transparent text-[16px]"
                required
              />
            </div>
            
            <button 
              type="submit"
              className='w-[70%] h-[50px] bg-black text-white font-semibold cursor-pointer rounded-2xl flex items-center justify-center hover:bg-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={loading}
            >
              {loading ? <ClipLoader size={25} color='white' /> : "Send OTP"}
            </button>
          </form>

          <p className="cursor-pointer text-gray-800 text-sm" onClick={() => navigate("/signin")}>
            Remember your password?{" "}
            <span className="border-b-2 border-b-black pb-[3px] text-black">Sign In</span>
          </p>
        </div>
      )}

      {/* STEP 2: Verify OTP */}
      {step === 2 && (
        <div className='w-[90%] max-w-[500px] h-[450px] bg-white rounded-2xl flex justify-center items-center flex-col border-2 border-[#1a1f23] gap-5 p-6'>
          <h2 className='text-2xl font-bold'>Verify OTP</h2>
          <p className='text-gray-600 text-sm text-center'>We've sent a 6-digit code to {email}</p>
          
          <form onSubmit={handleStep2} className='w-full flex flex-col items-center gap-5'>
            {/* OTP FIELD */}
            <div
              className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl flex items-center px-4 cursor-text transition-all"
              onClick={() => setInputClicked({ ...inputClicked, otp: true })}
            >
              <label
                htmlFor="otp"
                className={`absolute left-4 px-1 bg-white text-gray-600 transition-all pointer-events-none
                  ${inputClicked.otp || otp ? "top-[-12px] text-[13px]" : "top-[15px] text-[15px]"}`}
              >
                Enter OTP
              </label>
              <input
                type="text"
                id="otp"
                value={otp}
                maxLength={6}
                onChange={(e) => {
                  setOtp(e.target.value)
                  if (e.target.value) {
                    setInputClicked({ ...inputClicked, otp: true })
                  }
                }}
                onFocus={() => setInputClicked({ ...inputClicked, otp: true })}
                onBlur={() => !otp && setInputClicked({ ...inputClicked, otp: false })}
                className="w-full h-full outline-none border-0 bg-transparent text-[16px]"
                required
              />
            </div>
            
            <button 
              type="submit"
              className='w-[70%] h-[50px] bg-black text-white font-semibold cursor-pointer rounded-2xl flex items-center justify-center hover:bg-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={loading}
            >
              {loading ? <ClipLoader size={25} color='white' /> : "Verify OTP"}
            </button>
          </form>

          <p className="cursor-pointer text-gray-800 text-sm" onClick={handleStep1}>
            Didn't receive code?{" "}
            <span className="border-b-2 border-b-black pb-[3px] text-black">Resend</span>
          </p>
        </div>
      )}

      {/* STEP 3: Reset Password */}
      {step === 3 && (
        <div className='w-[90%] max-w-[500px] h-[550px] bg-white rounded-2xl flex justify-center items-center flex-col border-2 border-[#1a1f23] gap-5 p-6'>
          <h2 className='text-2xl font-bold'>Reset Password</h2>
          <p className='text-gray-600 text-sm text-center'>Enter your new password</p>
          
          <form onSubmit={handleStep3} className='w-full flex flex-col items-center gap-5'>
            {/* NEW PASSWORD FIELD */}
            <div
              className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl flex items-center px-4 cursor-text transition-all"
              onClick={() => setInputClicked({ ...inputClicked, newPassword: true })}
            >
              <label
                htmlFor="newPassword"
                className={`absolute left-4 px-1 bg-white text-gray-600 transition-all pointer-events-none
                  ${inputClicked.newPassword || newPassword ? "top-[-12px] text-[13px]" : "top-[15px] text-[15px]"}`}
              >
                New Password
              </label>
              <input
                type={showNewPassword ? "text" : "password"}
                id="newPassword"
                value={newPassword}
                minLength={6}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  if (e.target.value) {
                    setInputClicked({ ...inputClicked, newPassword: true })
                  }
                }}
                onFocus={() => setInputClicked({ ...inputClicked, newPassword: true })}
                onBlur={() => !newPassword && setInputClicked({ ...inputClicked, newPassword: false })}
                className="w-full h-full outline-none border-0 bg-transparent text-[16px]"
                required
              />
              {!showNewPassword ? (
                <IoIosEye
                  className="absolute right-4 w-[26px] h-[26px] text-gray-600 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowNewPassword(true)
                  }}
                />
              ) : (
                <IoIosEyeOff
                  className="absolute right-4 w-[26px] h-[26px] text-gray-600 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowNewPassword(false)
                  }}
                />
              )}
            </div>

            {/* CONFIRM PASSWORD FIELD */}
            <div
              className="relative w-[90%] h-[55px] border-2 border-black rounded-2xl flex items-center px-4 cursor-text transition-all"
              onClick={() => setInputClicked({ ...inputClicked, confirmPassword: true })}
            >
              <label
                htmlFor="confirmPassword"
                className={`absolute left-4 px-1 bg-white text-gray-600 transition-all pointer-events-none
                  ${inputClicked.confirmPassword || confirmPassword ? "top-[-12px] text-[13px]" : "top-[15px] text-[15px]"}`}
              >
                Confirm Password
              </label>
              <input
                type={showConfirmPassword ? "text" : "password"}
                id="confirmPassword"
                value={confirmPassword}
                minLength={6}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  if (e.target.value) {
                    setInputClicked({ ...inputClicked, confirmPassword: true })
                  }
                }}
                onFocus={() => setInputClicked({ ...inputClicked, confirmPassword: true })}
                onBlur={() => !confirmPassword && setInputClicked({ ...inputClicked, confirmPassword: false })}
                className="w-full h-full outline-none border-0 bg-transparent text-[16px]"
                required
              />
              {!showConfirmPassword ? (
                <IoIosEye
                  className="absolute right-4 w-[26px] h-[26px] text-gray-600 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowConfirmPassword(true)
                  }}
                />
              ) : (
                <IoIosEyeOff
                  className="absolute right-4 w-[26px] h-[26px] text-gray-600 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowConfirmPassword(false)
                  }}
                />
              )}
            </div>
            
            <button 
              type="submit"
              className='w-[70%] h-[50px] bg-black text-white font-semibold cursor-pointer rounded-2xl flex items-center justify-center hover:bg-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={loading}
            >
              {loading ? <ClipLoader size={25} color='white' /> : "Reset Password"}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default ForgotPassword
