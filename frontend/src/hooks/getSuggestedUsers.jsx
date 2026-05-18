import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { setSuggestedUsers } from "../redux/userSlice";
import { apiUrl } from "../config/api";

const useGetSuggestedUsers = (userData) => {
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // ✅ Only fetch when user is logged in
    if (!userData) return;

    const fetchSuggestedUsers = async () => {
      setLoading(true);
      try {
        const res = await fetch(apiUrl("/api/users/suggested"), {
          credentials: "include",
        });

        if (res.ok) {
          const data = await res.json();
          dispatch(setSuggestedUsers(data));
        } else {
          dispatch(setSuggestedUsers([]));
        }
      } catch (error) {
        console.error("Failed to fetch suggested users:", error);
        dispatch(setSuggestedUsers([]));
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestedUsers();
  }, [userData, dispatch]);

  return loading;
};

export default useGetSuggestedUsers;
