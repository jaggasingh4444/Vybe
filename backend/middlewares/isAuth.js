import jwt from "jsonwebtoken";

const isAuth = async (req, res, next) => {
  try {
    const headerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
    const token = headerToken || req.query.token || req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: "Token not found" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.userId = decoded.id || decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Auth failed" });
  }
};

export default isAuth;
