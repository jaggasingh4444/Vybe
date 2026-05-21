const getAdminEmails = () =>
  new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

export const isAdminUser = (user) => {
  if (!user) return false;

  const email = (user.email || "").toLowerCase();
  return user.role === "admin" || getAdminEmails().has(email);
};

export const toSafeUser = (user) => {
  if (!user) return null;

  const safeUser = user.toObject ? user.toObject() : { ...user };
  delete safeUser.password;
  delete safeUser.resetOtp;
  delete safeUser.otpExpires;
  delete safeUser.isOtpVerified;

  if (isAdminUser(safeUser)) {
    safeUser.role = "admin";
    safeUser.isVerified = true;
    safeUser.verificationStatus = "approved";
  }

  return safeUser;
};

export const getAdminEmailList = () => [...getAdminEmails()];
