import sendMail from "../config/Mail.js"
import genToken from "../config/token.js"
import User from "../models/user.model.js"
import EmailVerification from "../models/emailVerification.model.js"
import bcrypt from "bcryptjs"
import { toSafeUser } from "../utils/admin.js"

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const VERIFIED_SIGNUP_EXPIRY_MS = 10 * 60 * 1000;
const AUTH_COOKIE_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const normalizeEmail = (email = "") => email.trim().toLowerCase();
const getAuthCookieOptions = () => {
    const isProduction = process.env.NODE_ENV === "production";

    return {
        httpOnly:true,
        maxAge:AUTH_COOKIE_MAX_AGE_MS,
        secure:isProduction,
        sameSite:isProduction ? "none" : "lax",
        path:"/"
    }
};
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,}$/i;
const COMMON_EMAIL_DOMAIN_TYPOS = new Set([
    "gamil.com",
    "gmial.com",
    "gmai.com",
    "gmal.com",
    "gnail.com",
    "gmail.con",
    "gmail.co",
    "gmail.cm",
    "gmail.om",
    "gmail.cim",
    "hotmial.com",
    "hotmai.com",
    "yaho.com",
    "yahoo.co",
]);
const isValidEmail = (email) => {
    const normalizedEmail = normalizeEmail(email);
    if(!normalizedEmail || normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)){
        return false;
    }

    const parts = normalizedEmail.split("@");
    if(parts.length !== 2){
        return false;
    }

    const [localPart, domain] = parts;
    if(
        !localPart ||
        !domain ||
        localPart.length > 64 ||
        localPart.startsWith(".") ||
        localPart.endsWith(".") ||
        localPart.includes("..") ||
        domain.includes("..") ||
        COMMON_EMAIL_DOMAIN_TYPOS.has(domain)
    ){
        return false;
    }

    return domain
        .split(".")
        .every((label) => label && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-"));
};
const createOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

export const signUp=async (req, res)=>{
    try{
        const {name,password} = req.body
        const email = normalizeEmail(req.body.email)
        const userName = req.body.userName?.trim()
        if(!name || !email || !password || !userName){
            return res.status(400).json({message:"All fields are required"})
        }
        if(!isValidEmail(email)){
            return res.status(400).json({message:"Enter a valid email address"})
        }

        const findByEmail= await User.findOne({email})
        if(findByEmail){
            return res.status(400).json({message:"Email already exist !"})
        }
        const findByUserName= await User.findOne({userName})
        if(findByUserName){
            return res.status(400).json({message:"Username already exist !"})
        }

        if(password.length<6){
            return res.status(400).json({message:"Password must be at least six characters"})
        }

        const verification = await EmailVerification.findOne({
            email,
            verified: true,
            expiresAt: { $gt: new Date() },
        })

        if(!verification){
            return res.status(400).json({message:"Please verify your email before signing up"})
        }

        const hashedPassword = await bcrypt.hash(password,10)

        const user = await User.create({
            name:name.trim(),
            userName,
            email,
            password:hashedPassword
        })

        await EmailVerification.deleteOne({email})

        const token = await genToken(user._id)

        res.cookie("token",token,getAuthCookieOptions())
        const safeUser = toSafeUser(user)
        safeUser.authToken = token

        return res.status(201).json(safeUser)

    }catch(error){
        return res.status(500).json({message:`signup error ${error.message}`})        
    }
}

export const sendSignupOtp=async (req, res)=>{
    try {
        const email = normalizeEmail(req.body.email)
        if(!email){
            return res.status(400).json({message:"Email is required"})
        }
        if(!isValidEmail(email)){
            return res.status(400).json({message:"Enter a valid email address"})
        }

        const existingUser = await User.findOne({email})
        if(existingUser){
            return res.status(400).json({message:"Email already exist !"})
        }

        const otp = createOtp()
        const otpHash = await bcrypt.hash(otp, 10)

        await EmailVerification.findOneAndUpdate(
            {email},
            {
                $set: {
                    otpHash,
                    verified: false,
                    attempts: 0,
                    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
                },
                $unset: { verifiedAt: "" },
            },
            {upsert: true, new: true}
        )

        const mailResult = await sendMail(email, otp, {
            subject: "Verify Your Vybe Email",
            intro: "Your Vybe signup verification code is",
            expiresIn: "5 minutes",
        })

        if(!mailResult.success){
            return res.status(500).json({message:"Failed to send verification email"})
        }

        return res.status(200).json({message:"Verification code sent"})
    } catch (error) {
        return res.status(500).json({message:`signup otp error ${error.message}`})
    }
}

export const verifySignupOtp=async (req, res)=>{
    try {
        const email = normalizeEmail(req.body.email)
        const otp = req.body.otp?.trim()
        if(!email || !otp){
            return res.status(400).json({message:"Email and code are required"})
        }
        if(!isValidEmail(email)){
            return res.status(400).json({message:"Enter a valid email address"})
        }

        const verification = await EmailVerification.findOne({email})
        if(!verification || verification.expiresAt < new Date()){
            return res.status(400).json({message:"Invalid or expired verification code"})
        }
        if(verification.attempts >= 5){
            return res.status(429).json({message:"Too many attempts. Please request a new code"})
        }

        const isMatch = await bcrypt.compare(otp, verification.otpHash || "")
        if(!isMatch){
            verification.attempts += 1
            await verification.save()
            return res.status(400).json({message:"Invalid verification code"})
        }

        verification.verified = true
        verification.verifiedAt = new Date()
        verification.expiresAt = new Date(Date.now() + VERIFIED_SIGNUP_EXPIRY_MS)
        verification.otpHash = undefined
        verification.attempts = 0
        await verification.save()

        return res.status(200).json({message:"Email verified successfully"})
    } catch (error) {
        return res.status(500).json({message:`verify signup otp error ${error.message}`})
    }
}

export const signIn = async (req, res) => {
  try {
    const { password } = req.body;
    const login = (req.body.login || req.body.identifier || req.body.userName || req.body.email || "").trim();
    if (!login || !password) {
      return res.status(400).json({ message: "Username/email and password are required" });
    }

    const normalizedEmail = normalizeEmail(login);
    const user = await User.findOne({
      $or: [
        { userName: login },
        { email: normalizedEmail },
      ],
    });
    if (!user) {
      return res.status(400).json({ message: "User not found!" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect password!" });
    }

    const token = await genToken(user._id);

    res.cookie("token", token, getAuthCookieOptions());

    // ❌ never send password
    const safeUser = toSafeUser(user);
    safeUser.authToken = token;

    return res.status(200).json(safeUser);

  } catch (error) {
    return res.status(500).json({
      message: "Signin error",
      error: error.message,
    });
  }
};


export const signOut = async(req, res)=>{
    try {
        const cookieOptions = getAuthCookieOptions();
        delete cookieOptions.maxAge;
        res.clearCookie("token", cookieOptions);
        return res.status(200).json({message:"Sign out successfully"})
    } catch (error) {
        return res.status(500).json({message:`signout error ${error}`})          
    }
}

export const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body

        if(!currentPassword || !newPassword){
            return res.status(400).json({message:"Current password and new password are required"})
        }

        if(newPassword.length < 6){
            return res.status(400).json({message:"New password must be at least six characters"})
        }

        const user = await User.findById(req.userId)
        if(!user){
            return res.status(404).json({message:"User not found"})
        }

        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
        if(!isCurrentPasswordValid){
            return res.status(400).json({message:"Current password is incorrect"})
        }

        const isSamePassword = await bcrypt.compare(newPassword, user.password)
        if(isSamePassword){
            return res.status(400).json({message:"Choose a different new password"})
        }

        user.password = await bcrypt.hash(newPassword, 10)
        user.resetOtp = undefined
        user.otpExpires = undefined
        user.isOtpVerified = false

        await user.save()

        return res.status(200).json({message:"Password changed successfully"})
    } catch (error) {
        return res.status(500).json({message:`change password error ${error.message}`})
    }
}

// FIXED: Send OTP
export const sendOtp=async (req, res)=>{
    try {
        const email = normalizeEmail(req.body.email)
        if(!email){
            return res.status(400).json({message:"Email is required"})
        }
        if(!isValidEmail(email)){
            return res.status(400).json({message:"Enter a valid email address"})
        }

        const user = await User.findOne({email})
        if(!user){
            return res.status(400).json({message:"User not found"})
        }
        
        // Fixed: 6-digit OTP instead of 4
        const otp = Math.floor(100000 + Math.random() * 900000).toString()

        // Fixed: Removed extra comma, fixed Date.now()
        user.resetOtp = otp
        user.otpExpires = Date.now() + 5*60*1000  // Fixed: removed "new"
        user.isOtpVerified = false

        await user.save()
        const mailResult = await sendMail(email, otp)
        if(!mailResult.success){
            return res.status(500).json({message:"Failed to send OTP email"})
        }
        
        // Fixed: Changed "response" to "res"
        return res.status(200).json({message:"OTP sent successfully"})

    } catch (error) {
        return res.status(500).json({message:`send otp error ${error.message}`})
    }
}

// FIXED: Verify OTP
export const verifyOtp=async (req, res)=>{
    try {
        const email = normalizeEmail(req.body.email)
        const otp = req.body.otp
        if(!email || !otp){
            return res.status(400).json({message:"Email and OTP are required"})
        }
        if(!isValidEmail(email)){
            return res.status(400).json({message:"Enter a valid email address"})
        }

        const user = await User.findOne({email})
        
        if(!user || user.resetOtp !== otp || user.otpExpires < Date.now()){
            return res.status(400).json({message:"Invalid or expired OTP"})
        }
        
        user.isOtpVerified = true
        user.resetOtp = undefined
        user.otpExpires = undefined

        await user.save()
        
        // Fixed: Changed "response" to "res"
        return res.status(200).json({message:"OTP verified successfully"})

    } catch (error) {
        return res.status(500).json({message:`verify otp error ${error.message}`})
    }
}

// FIXED: Reset Password
export const resetPassword=async (req, res)=>{
    try {
        const email = normalizeEmail(req.body.email)
        const {password}=req.body
        if(!email || !password){
            return res.status(400).json({message:"Email and password are required"})
        }
        if(!isValidEmail(email)){
            return res.status(400).json({message:"Enter a valid email address"})
        }
        if(password.length < 6){
            return res.status(400).json({message:"Password must be at least six characters"})
        }

        const user = await User.findOne({email})
        
        // Fixed: Changed condition - should be !user.isOtpVerified (with !)
        if(!user || !user.isOtpVerified){
            return res.status(400).json({message:"OTP verification required"})
        }

        const hashedPassword = await bcrypt.hash(password, 10)
        user.password = hashedPassword
        user.isOtpVerified = false
        
        await user.save()
        
        // Fixed: Changed "response" to "res"
        return res.status(200).json({message:"Password reset successfully"})

    } catch (error) {
        return res.status(500).json({message:`reset password error ${error.message}`})
    }
}

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");

    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    return res.status(200).json(toSafeUser(user));
  } catch (error) {
    return res.status(500).json({ message: "GetMe error" });
  }
};
