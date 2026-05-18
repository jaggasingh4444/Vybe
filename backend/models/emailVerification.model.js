import mongoose from "mongoose";

const emailVerificationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    otpHash: {
      type: String,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
    verifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

const EmailVerification = mongoose.model("EmailVerification", emailVerificationSchema);

export default EmailVerification;
