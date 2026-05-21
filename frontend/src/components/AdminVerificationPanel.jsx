import React, { useCallback, useEffect, useState } from "react";
import dp from "../assets/dp.png";
import { apiUrl, mediaUrl } from "../config/api";
import VerifiedBadge from "./VerifiedBadge";

function AdminVerificationPanel({ userData }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState("");
  const [status, setStatus] = useState("");
  const isAdmin = userData?.role === "admin";

  const fetchRequests = useCallback(async () => {
    if (!isAdmin) return;

    setLoading(true);
    setStatus("");

    try {
      const res = await fetch(apiUrl("/api/admin/users/pending-verification"), {
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Unable to load verification requests");

      setUsers(data);
    } catch (error) {
      setStatus(error.message || "Unable to load verification requests.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const updateVerification = async (targetUserId, action) => {
    setBusyUserId(targetUserId);
    setStatus("");

    try {
      const res = await fetch(apiUrl(`/api/admin/users/${targetUserId}/${action}-verification`), {
        method: "PATCH",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Verification update failed");

      setUsers((currentUsers) => currentUsers.filter((user) => user._id !== targetUserId));
      setStatus(
        action === "approve"
          ? `${data.userName || "User"} is verified now.`
          : `${data.userName || "User"} was rejected.`
      );
    } catch (error) {
      setStatus(error.message || "Verification update failed.");
    } finally {
      setBusyUserId("");
    }
  };

  if (!isAdmin) return null;

  return (
    <section className="border-t border-gray-900 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Profile verification</p>
          <p className="truncate text-xs text-gray-500">Approve new users before blue tick appears.</p>
        </div>
        <button
          type="button"
          onClick={fetchRequests}
          disabled={loading}
          className="h-8 shrink-0 rounded-md bg-[#111] px-3 text-xs font-semibold text-blue-400 disabled:opacity-60"
        >
          {loading ? "Loading" : "Refresh"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {users.length > 0 ? (
          users.map((pendingUser) => (
            <div
              key={pendingUser._id}
              className="flex items-center gap-3 rounded-lg border border-gray-900 bg-[#080808] p-3"
            >
              <img
                src={mediaUrl(pendingUser.profileImage) || dp}
                alt={pendingUser.userName || "profile"}
                className="h-11 w-11 rounded-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = dp;
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-white">
                  <span className="truncate">{pendingUser.userName || "new_user"}</span>
                  {pendingUser.isVerified ? <VerifiedBadge /> : null}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {[pendingUser.name, pendingUser.email].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateVerification(pendingUser._id, "reject")}
                  disabled={Boolean(busyUserId)}
                  className="h-8 rounded-md bg-[#111] px-3 text-xs font-semibold text-gray-300 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => updateVerification(pendingUser._id, "approve")}
                  disabled={Boolean(busyUserId)}
                  className="h-8 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busyUserId === pendingUser._id ? "..." : "Approve"}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-gray-900 bg-[#080808] px-3 py-4 text-sm text-gray-500">
            {loading ? "Loading requests..." : "No pending verification requests."}
          </div>
        )}
      </div>

      {status ? (
        <p className={`mt-3 text-sm ${status.includes("verified") ? "text-green-400" : "text-gray-500"}`}>
          {status}
        </p>
      ) : null}
    </section>
  );
}

export default AdminVerificationPanel;
