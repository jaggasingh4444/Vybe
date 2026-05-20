import express from "express"
import isAuth from "../middlewares/isAuth.js"
import { getCurrentUser, getUserConnections, getUserProfile, removeFollower, searchUsers, suggestedUsers, toggleFollow, updateProfile } from "../controllers/user.controllers.js"


const userRouter = express.Router()

userRouter.get("/current",isAuth,getCurrentUser)
userRouter.get("/suggested",isAuth,suggestedUsers)
userRouter.get("/search",isAuth,searchUsers)
userRouter.get("/:userId/connections",isAuth,getUserConnections)
userRouter.get("/:userId/profile",isAuth,getUserProfile)
userRouter.patch("/profile",isAuth,updateProfile)
userRouter.post("/:userId/follow",isAuth,toggleFollow)
userRouter.delete("/:userId/follower",isAuth,removeFollower)

export default userRouter
