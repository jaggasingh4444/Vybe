import express from "express"
import { changePassword, resetPassword, sendOtp, sendSignupOtp, signIn, signOut, signUp, verifyOtp, verifySignupOtp } from "../controllers/auth.controllers.js"
import isAuth from "../middlewares/isAuth.js"
import User from "../models/user.model.js";
import { toSafeUser } from "../utils/admin.js";

const authRouter = express.Router()

authRouter.post("/signup",signUp)
authRouter.post("/signup/send-otp",sendSignupOtp)
authRouter.post("/signup/verify-otp",verifySignupOtp)
authRouter.post("/signin",signIn)
authRouter.post("/sendOtp",sendOtp)
authRouter.post("/verifyOtp",verifyOtp)
authRouter.post("/resetPassword",resetPassword)
authRouter.patch("/change-password",isAuth,changePassword)
authRouter.post("/signout",signOut)

authRouter.get("/me", isAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    res.status(200).json(toSafeUser(user));
  } catch (error) {
    res.status(500).json({ message: "Failed to get user" });
  }
});


export default authRouter
