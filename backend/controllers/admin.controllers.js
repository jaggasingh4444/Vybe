import mongoose from "mongoose";
import User from "../models/user.model.js";
import { getAdminEmailList, toSafeUser } from "../utils/admin.js";

const pendingVerificationFilter = (currentUserId) => ({
  _id: { $ne: currentUserId },
  role: { $ne: "admin" },
  email: { $nin: getAdminEmailList() },
  $or: [
    { verificationStatus: "pending" },
    { verificationStatus: { $exists: false } },
  ],
});

export const getPendingVerificationUsers = async (req, res) => {
  try {
    const users = await User.find(pendingVerificationFilter(req.userId))
      .select("-password -resetOtp -otpExpires -isOtpVerified")
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json(users.map(toSafeUser));
  } catch (error) {
    return res.status(500).json({ message: `verification users error ${error.message}` });
  }
};

export const approveUserVerification = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          isVerified: true,
          verificationStatus: "approved",
          verifiedAt: new Date(),
          verifiedBy: req.userId,
        },
      },
      { new: true }
    ).select("-password -resetOtp -otpExpires -isOtpVerified");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(toSafeUser(user));
  } catch (error) {
    return res.status(500).json({ message: `approve verification error ${error.message}` });
  }
};

export const rejectUserVerification = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          isVerified: false,
          verificationStatus: "rejected",
        },
        $unset: {
          verifiedAt: "",
          verifiedBy: "",
        },
      },
      { new: true }
    ).select("-password -resetOtp -otpExpires -isOtpVerified");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(toSafeUser(user));
  } catch (error) {
    return res.status(500).json({ message: `reject verification error ${error.message}` });
  }
};
