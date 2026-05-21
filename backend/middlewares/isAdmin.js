import User from "../models/user.model.js";
import { isAdminUser } from "../utils/admin.js";

const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("email role");

    if (!isAdminUser(user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    req.adminUser = user;
    return next();
  } catch (error) {
    return res.status(500).json({ message: `admin check error ${error.message}` });
  }
};

export default isAdmin;
