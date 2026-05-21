import React, { useEffect, useState } from "react";
import logo from "../assets/logo1.png";
import dp from "../assets/dp.png";
import { useDispatch, useSelector } from "react-redux";
import { logout, setUserData } from "../redux/userSlice";
import { apiUrl, mediaUrl } from "../config/api";
import { markTabLoggedOut } from "../utils/tabAuth";
import {
  FiBell,
  FiBookmark,
  FiCamera,
  FiHome,
  FiLock,
  FiLogOut,
  FiMessageCircle,
  FiMoon,
  FiPlusSquare,
  FiSave,
  FiSettings,
  FiSun,
  FiUser,
  FiX,
} from "react-icons/fi";
import { useThemePreference } from "../utils/theme";
import AdminVerificationPanel from "./AdminVerificationPanel";
import VerifiedBadge from "./VerifiedBadge";

const MAX_AVATAR_SIZE = 3 * 1024 * 1024;
const getIdString = (value) => (value?._id || value || "").toString();
const uniqueCount = (items = []) => new Set(items.map(getIdString).filter(Boolean)).size;

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function LeftHome() {
  const { userData } = useSelector((state) => state.user);
  const dispatch = useDispatch();
  const [theme, setTheme] = useThemePreference();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState("");
  const [userName, setUserName] = useState("");
  const [profileImage, setProfileImage] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState(() => {
    return localStorage.getItem("vybe-notifications") !== "off";
  });
  const [privateAccount, setPrivateAccount] = useState(() => {
    return localStorage.getItem("vybe-private-account") === "on";
  });

  useEffect(() => {
    if (!userData) return;

    setName(userData.name || "");
    setUserName(userData.userName || "");
    setProfileImage(userData.profileImage || "");
  }, [userData]);

  useEffect(() => {
    localStorage.setItem("vybe-notifications", notifications ? "on" : "off");
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem("vybe-private-account", privateAccount ? "on" : "off");
  }, [privateAccount]);

  const handleLogout = async () => {
    markTabLoggedOut();
    dispatch(logout());
  };

  const handleForgotPassword = async () => {
    markTabLoggedOut();
    dispatch(logout());
    window.location.assign("/forgot-password");
  };

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setStatus("");

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file for your profile photo.");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setStatus("Profile photo must be under 3 MB.");
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setProfileImage(dataUrl);
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    try {
      const res = await fetch(apiUrl("/api/users/profile"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, userName, profileImage }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Profile update failed");

      dispatch(setUserData(data));
      setStatus("Profile updated.");
    } catch (error) {
      setStatus(error.message || "Profile update failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordStatus("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordStatus("Fill all password fields.");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordStatus("New password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordStatus("New passwords do not match.");
      return;
    }

    setPasswordSaving(true);

    try {
      const res = await fetch(apiUrl("/api/auth/change-password"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Password change failed");

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus("Password changed successfully.");
      setPasswordPanelOpen(false);
    } catch (error) {
      setPasswordStatus(error.message || "Password change failed.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const postCount = userData?.posts?.length || 0;
  const followerCount = uniqueCount(userData?.followers);
  const followingCount = uniqueCount(userData?.following);

  const openOwnProfile = () => {
    window.dispatchEvent(
      new CustomEvent("vybe:open-profile", {
        detail: { user: userData },
      })
    );
  };

  const openOwnConnections = (type) => {
    window.dispatchEvent(
      new CustomEvent("vybe:open-profile-connections", {
        detail: { user: userData, type },
      })
    );
  };

  const handleMenuAction = (action) => {
    if (action === "profile") {
      openOwnProfile();
      return;
    }

    window.dispatchEvent(
      new CustomEvent("vybe:sidebar-action", {
        detail: { action },
      })
    );
  };

  const menuItems = [
    { icon: <FiHome />, label: "Home", value: "Feed", action: "home" },
    { icon: <FiPlusSquare />, label: "Create", value: "Post/Reel", action: "create" },
    { icon: <FiMessageCircle />, label: "Messages", value: "Live", action: "messages" },
    { icon: <FiBookmark />, label: "Saved", value: userData?.saved?.length || 0, action: "saved" },
    { icon: <FiUser />, label: "Profile", value: "Edit", action: "profile" },
  ];

  return (
    <aside className="hidden lg:flex lg:w-[300px] xl:w-[340px] shrink-0 min-h-[100vh] bg-black border-r border-gray-900 flex-col">
      <div className="w-full h-[96px] flex items-center justify-between px-6">
        <img src={logo} alt="logo" className="w-[92px]" />
        <div className="flex items-center text-white text-2xl">
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(true);
              setStatus("");
            }}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#101010] hover:text-blue-400"
            aria-label="Open settings"
          >
            <FiSettings />
          </button>
        </div>
      </div>

      <div className="px-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={openOwnProfile}
            className="w-[78px] h-[78px] rounded-full overflow-hidden bg-[#191919] border border-gray-800"
            aria-label="Open profile"
          >
            <img
              src={mediaUrl(userData?.profileImage) || dp}
              alt="profile"
              className="w-full h-full object-cover"
              onError={(event) => {
                event.currentTarget.src = dp;
              }}
            />
          </button>

          <button
            type="button"
            onClick={openOwnProfile}
            className="min-w-0 flex-1 text-left"
          >
            <p className="flex min-w-0 items-center gap-1.5 text-[22px] text-white font-bold">
              <span className="truncate">{userData?.userName}</span>
              {userData?.isVerified ? <VerifiedBadge className="h-5 w-5" /> : null}
            </p>
            <p className="text-[17px] text-gray-400 truncate">{userData?.name}</p>
          </button>

        </div>

        <div className="grid grid-cols-3 gap-2 mt-7 border-y border-gray-900 py-4">
          <div>
            <p className="text-white font-bold text-lg">{postCount}</p>
            <p className="text-gray-500 text-xs">Posts</p>
          </div>
          <button
            type="button"
            onClick={() => openOwnConnections("followers")}
            className="text-left"
          >
            <p className="text-white font-bold text-lg">{followerCount}</p>
            <p className="text-gray-500 text-xs">Followers</p>
          </button>
          <button
            type="button"
            onClick={() => openOwnConnections("following")}
            className="text-left"
          >
            <p className="text-white font-bold text-lg">{followingCount}</p>
            <p className="text-gray-500 text-xs">Following</p>
          </button>
        </div>

        <nav className="mt-6 flex flex-col gap-2">
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => handleMenuAction(item.action)}
              className="h-12 flex items-center justify-between rounded-md px-3 text-left text-gray-200 hover:bg-[#101010]"
            >
              <span className="flex items-center gap-3 text-[15px]">
                <span className="text-xl">{item.icon}</span>
                {item.label}
              </span>
              <span className="text-xs text-gray-500">{item.value}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto px-6 pb-7">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="w-full h-11 rounded-md bg-white text-black font-semibold flex items-center justify-center gap-2"
        >
          <FiSettings /> Settings
        </button>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4">
          <div className="w-full max-w-[520px] max-h-[92vh] overflow-y-auto rounded-lg border border-gray-800 bg-[#050505] text-white">
            <div className="h-14 px-5 flex items-center justify-between border-b border-gray-900">
              <h2 className="font-semibold">Settings</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white"
                aria-label="Close settings"
              >
                <FiX />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="p-5 flex flex-col gap-5">
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 rounded-full overflow-hidden bg-[#171717] border border-gray-800 shrink-0">
                  <img
                    src={mediaUrl(profileImage) || dp}
                    alt="Profile preview"
                    className="w-full h-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = dp;
                    }}
                  />
                  <label className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 flex items-center justify-center cursor-pointer">
                    <FiCamera className="text-2xl" />
                    <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                  </label>
                </div>
                <div>
                  <p className="font-semibold">Edit profile</p>
                  <p className="text-sm text-gray-500">Update your public name, username, and photo.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-sm text-gray-400">
                  Name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white outline-none focus:border-gray-500"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-gray-400">
                  Username
                  <input
                    value={userName}
                    onChange={(event) => setUserName(event.target.value)}
                    className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white outline-none focus:border-gray-500"
                    required
                  />
                </label>
              </div>

              <div className="border-t border-gray-900 pt-4 flex flex-col gap-3">
                <SettingToggle
                  icon={<FiBell />}
                  title="Notifications"
                  description="Keep activity alerts enabled in this browser."
                  checked={notifications}
                  onChange={setNotifications}
                />
                <SettingToggle
                  icon={<FiLock />}
                  title="Private account"
                  description="Store your privacy preference for this device."
                  checked={privateAccount}
                  onChange={setPrivateAccount}
                />
                <SettingToggle
                  icon={theme === "light" ? <FiSun /> : <FiMoon />}
                  title="Bright mode"
                  description="Switch Vybe between dark and bright appearance."
                  checked={theme === "light"}
                  onChange={(checked) => setTheme(checked ? "light" : "dark")}
                />
              </div>

              <AdminVerificationPanel userData={userData} />

              <div className="border-t border-gray-900 pt-4">
                <div className="flex items-center justify-between gap-4 rounded-md bg-[#080808] p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Account</p>
                    <p className="text-xs text-gray-500">Sign out from this browser.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="h-10 shrink-0 rounded-md bg-[#171717] px-4 text-sm font-semibold text-red-300 hover:bg-red-500/10 hover:text-red-200"
                  >
                    <span className="flex items-center gap-2">
                      <FiLogOut /> Logout
                    </span>
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-900 pt-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (passwordPanelOpen) return;
                      setPasswordPanelOpen(true);
                      setPasswordStatus("");
                    }}
                    className="min-w-0 flex-1 flex items-center gap-3 rounded-md text-left hover:bg-[#111]"
                    aria-expanded={passwordPanelOpen}
                  >
                    <span className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center text-lg shrink-0">
                      <FiLock />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Change password</p>
                      <p className="text-xs text-gray-500 truncate">
                        Use your current password to set a new one.
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="h-10 px-3 rounded-md text-blue-400 font-semibold hover:bg-[#111]"
                    >
                      Forgot password
                    </button>
                  </div>
                </div>

                {!passwordPanelOpen && passwordStatus ? (
                  <p className={`text-sm ${passwordStatus === "Password changed successfully." ? "text-green-400" : "text-gray-500"}`}>
                    {passwordStatus}
                  </p>
                ) : null}

                {passwordPanelOpen ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        placeholder="Current password"
                        className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white text-sm outline-none focus:border-gray-500 placeholder:text-gray-600"
                      />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="New password"
                        className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white text-sm outline-none focus:border-gray-500 placeholder:text-gray-600"
                      />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Confirm password"
                        className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white text-sm outline-none focus:border-gray-500 placeholder:text-gray-600"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-sm ${passwordStatus === "Password changed successfully." ? "text-green-400" : "text-gray-500"}`}>
                        {passwordStatus || "Forgot password is available on the sign-in screen."}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPasswordPanelOpen(false);
                            setCurrentPassword("");
                            setNewPassword("");
                            setConfirmPassword("");
                            setPasswordStatus("");
                          }}
                          className="h-10 px-3 rounded-md text-gray-400 font-semibold hover:bg-[#111]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleChangePassword}
                          disabled={passwordSaving}
                          className="h-10 px-4 rounded-md bg-[#171717] text-white font-semibold flex items-center gap-2 disabled:opacity-60"
                        >
                          <FiLock /> {passwordSaving ? "Changing..." : "Save password"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-gray-900 pt-4">
                <p className={`text-sm ${status === "Profile updated." ? "text-green-400" : "text-gray-500"}`}>
                  {status || "Settings are saved instantly where possible."}
                </p>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 px-5 rounded-md bg-white text-black font-semibold flex items-center gap-2 disabled:opacity-60"
                >
                  <FiSave /> {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function SettingToggle({ icon, title, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center text-lg shrink-0">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-gray-500 truncate">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full p-1 transition-colors ${checked ? "bg-blue-600" : "bg-gray-700"}`}
        aria-pressed={checked}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export default LeftHome;
