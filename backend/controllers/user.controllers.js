import mongoose from "mongoose"
import Loop from "../models/loop.model.js";
import Post from "../models/post.model.js";
import User from "../models/user.model.js"
import genToken from "../config/token.js";
import { isDataUrl, saveDataUrlMedia } from "../utils/mediaStorage.js";
import { createNotification } from "./content.controllers.js";
import { toSafeUser } from "../utils/admin.js";

const safeUserSelect = "-password -resetOtp -otpExpires -isOtpVerified";
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const uniqueUsersById = (users = []) => {
    const seen = new Set();
    return users.filter((user) => {
        const id = (user?._id || user || "").toString();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
};
const serializeProfileContent = (item, type) => ({
    _id: item._id,
    type,
    author: item.author,
    mediaType: item.mediaType || (type === "reel" ? "video" : "text"),
    media: item.media || "",
    caption: item.caption || "",
    likes: item.likes || [],
    comments: item.comments || [],
    createdAt: item.createdAt,
});

const populateProfileContent = (query) =>
    query
        .populate("author", "name userName profileImage isVerified")
        .populate("comments.author", "name userName profileImage isVerified")
        .populate("comments.replies.author", "name userName profileImage isVerified");

const persistLegacyProfileMedia = async (item, req) => {
    if (!isDataUrl(item.media)) return item;

    item.media = await saveDataUrlMedia(item.media, "content", req);
    await item.save();
    return item;
};

const persistLegacyProfileImage = async (user, req) => {
    if (!user || !isDataUrl(user.profileImage)) return user;

    const profileImage = await saveDataUrlMedia(user.profileImage, "profiles", req);
    user.profileImage = profileImage;
    await User.findByIdAndUpdate(user._id, { $set: { profileImage } });
    return user;
};

export const getCurrentUser = async (req, res)=>{
    try {
        const userId= req.userId
        const user = await User.findById(userId).select(safeUserSelect)
        if(!user){
            return res.status(404).json({message:"User not found"})
        }
        await persistLegacyProfileImage(user, req);
        const safeUser = toSafeUser(user)
        safeUser.authToken = await genToken(user._id)

        return res.status(200).json(safeUser)
    } catch (error) {
            return res.status(500).json({message:`get current user error ${error.message}`})            
    }
}

export const suggestedUsers = async (req, res) => {
    try {
        const users = await User.find({
            _id: { $ne: req.userId }
        }).select(safeUserSelect).limit(12);
        await Promise.all(users.map((user) => persistLegacyProfileImage(user, req)));
        return res.status(200).json(users.map(toSafeUser));
    } catch (error) {
        return res.status(500).json({ message: `suggested user error ${error.message}` });
    }
};

export const searchUsers = async (req, res) => {
    try {
        const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const normalizedQuery = rawQuery.replace(/^@/, "");

        if (!normalizedQuery) {
            return res.status(200).json([]);
        }

        const searchRegex = new RegExp(escapeRegex(normalizedQuery), "i");
        const searchConditions = [
            { userName: searchRegex },
            { name: searchRegex },
        ];

        if (mongoose.Types.ObjectId.isValid(normalizedQuery)) {
            searchConditions.push({ _id: normalizedQuery });
        }

        const users = await User.find({
            _id: { $ne: req.userId },
            $or: searchConditions,
        })
            .select(safeUserSelect)
            .limit(20);

        await Promise.all(users.map((user) => persistLegacyProfileImage(user, req)));
        return res.status(200).json(users.map(toSafeUser));
    } catch (error) {
        return res.status(500).json({ message: `search user error ${error.message}` });
    }
};

export const getUserProfile = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "Invalid user id" });
        }

        const user = await User.findById(userId).select(safeUserSelect);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        await persistLegacyProfileImage(user, req);

        const [posts, reels] = await Promise.all([
            populateProfileContent(Post.find({ author: userId }).sort({ createdAt: -1 }).limit(30)),
            populateProfileContent(Loop.find({ author: userId }).sort({ createdAt: -1 }).limit(30)),
        ]);

        await Promise.all([
            ...posts.map((post) => persistLegacyProfileMedia(post, req)),
            ...reels.map((reel) => persistLegacyProfileMedia(reel, req)),
        ]);

        const content = [
            ...posts.map((post) => serializeProfileContent(post, "post")),
            ...reels.map((reel) => serializeProfileContent(reel, "reel")),
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return res.status(200).json({
            user: toSafeUser(user),
            content,
        });
    } catch (error) {
        return res.status(500).json({ message: `profile error ${error.message}` });
    }
};

export const getUserConnections = async (req, res) => {
    try {
        const { userId } = req.params;
        const type = req.query.type === "following" ? "following" : "followers";

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "Invalid user id" });
        }

        const user = await User.findById(userId)
            .select(type)
            .populate(type, "name userName profileImage followers following isVerified verificationStatus");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const users = uniqueUsersById(user[type] || []);
        await Promise.all(users.map((connectionUser) => persistLegacyProfileImage(connectionUser, req)));

        return res.status(200).json({ type, users: users.map(toSafeUser) });
    } catch (error) {
        return res.status(500).json({ message: `connections error ${error.message}` });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const { name, userName, profileImage } = req.body;
        const updates = {};

        if (typeof name === "string" && name.trim()) {
            updates.name = name.trim();
        }

        if (typeof userName === "string" && userName.trim()) {
            const normalizedUserName = userName.trim();
            const existingUser = await User.findOne({
                userName: normalizedUserName,
                _id: { $ne: req.userId },
            });

            if (existingUser) {
                return res.status(400).json({ message: "Username already exist !" });
            }

            updates.userName = normalizedUserName;
        }

        if (typeof profileImage === "string") {
            const isImageDataUrl = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(profileImage);
            const isStoredProfileImage = /^https?:\/\/.+\/uploads\/profiles\/[^?#]+/.test(profileImage);
            const validImage = profileImage === "" || isImageDataUrl || isStoredProfileImage;

            if (!validImage) {
                return res.status(400).json({ message: "Valid profile image is required" });
            }

            updates.profileImage = isImageDataUrl
                ? await saveDataUrlMedia(profileImage, "profiles", req)
                : profileImage;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: "Nothing to update" });
        }

        const user = await User.findByIdAndUpdate(
            req.userId,
            { $set: updates },
            { new: true }
        ).select(safeUserSelect);

        return res.status(200).json(toSafeUser(user));
    } catch (error) {
        return res.status(500).json({ message: `update profile error ${error.message}` });
    }
};

export const toggleFollow = async (req, res) => {
    try {
        const currentUserId = req.userId;
        const targetUserId = req.params.userId;

        if (currentUserId === targetUserId) {
            return res.status(400).json({ message: "You cannot follow yourself" });
        }

        const [currentUser, targetUser] = await Promise.all([
            User.findById(currentUserId),
            User.findById(targetUserId),
        ]);

        if (!currentUser || !targetUser) {
            return res.status(404).json({ message: "User not found" });
        }

        const isFollowing = currentUser.following.some(
            (id) => id.toString() === targetUserId
        );

        if (isFollowing) {
            await Promise.all([
                User.findByIdAndUpdate(currentUserId, { $pull: { following: targetUserId } }),
                User.findByIdAndUpdate(targetUserId, { $pull: { followers: currentUserId } }),
            ]);
        } else {
            await Promise.all([
                User.findByIdAndUpdate(currentUserId, { $addToSet: { following: targetUserId } }),
                User.findByIdAndUpdate(targetUserId, { $addToSet: { followers: currentUserId } }),
            ]);

            await createNotification({
                recipient: targetUserId,
                actor: currentUserId,
                type: "follow",
                contentType: "user",
                contentId: currentUserId,
                text: "followed you",
            });
        }

        const [updatedCurrentUser, updatedTargetUser] = await Promise.all([
            User.findById(currentUserId).select(safeUserSelect),
            User.findById(targetUserId).select(safeUserSelect),
        ]);

        return res.status(200).json({
            following: !isFollowing,
            currentUser: toSafeUser(updatedCurrentUser),
            targetUser: toSafeUser(updatedTargetUser),
        });
    } catch (error) {
        return res.status(500).json({ message: `follow error ${error.message}` });
    }
};

export const removeFollower = async (req, res) => {
    try {
        const currentUserId = req.userId;
        const followerId = req.params.userId;

        if (currentUserId === followerId) {
            return res.status(400).json({ message: "You cannot remove yourself" });
        }

        if (!mongoose.Types.ObjectId.isValid(followerId)) {
            return res.status(400).json({ message: "Invalid user id" });
        }

        const [currentUser, followerUser] = await Promise.all([
            User.findById(currentUserId),
            User.findById(followerId),
        ]);

        if (!currentUser || !followerUser) {
            return res.status(404).json({ message: "User not found" });
        }

        await Promise.all([
            User.findByIdAndUpdate(currentUserId, { $pull: { followers: followerId } }),
            User.findByIdAndUpdate(followerId, { $pull: { following: currentUserId } }),
        ]);

        const [updatedCurrentUser, updatedTargetUser] = await Promise.all([
            User.findById(currentUserId).select(safeUserSelect),
            User.findById(followerId).select(safeUserSelect),
        ]);

        return res.status(200).json({
            removed: true,
            currentUser: toSafeUser(updatedCurrentUser),
            targetUser: toSafeUser(updatedTargetUser),
        });
    } catch (error) {
        return res.status(500).json({ message: `remove follower error ${error.message}` });
    }
};
