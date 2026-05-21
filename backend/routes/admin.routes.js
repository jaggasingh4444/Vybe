import express from "express";
import {
  approveUserVerification,
  getPendingVerificationUsers,
  rejectUserVerification,
} from "../controllers/admin.controllers.js";
import isAdmin from "../middlewares/isAdmin.js";
import isAuth from "../middlewares/isAuth.js";

const adminRouter = express.Router();

adminRouter.get("/users/pending-verification", isAuth, isAdmin, getPendingVerificationUsers);
adminRouter.patch("/users/:userId/approve-verification", isAuth, isAdmin, approveUserVerification);
adminRouter.patch("/users/:userId/reject-verification", isAuth, isAdmin, rejectUserVerification);

export default adminRouter;
