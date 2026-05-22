import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { setUserData, authChecked } from "../redux/userSlice";
import { apiUrl } from "../config/api";
import { clearTabAuthToken, getTabAuthHeaders, isTabLoggedOut, setTabAuthToken } from "../utils/tabAuth";

const useGetCurrentUser = () => {
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      if (isTabLoggedOut()) {
        dispatch(setUserData(null));
        dispatch(authChecked());
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(apiUrl("/api/users/current"), {
          credentials: "include",
          headers: getTabAuthHeaders(),
        });

        if (res.ok) {
          const data = await res.json();
          const { authToken, ...safeUser } = data;
          setTabAuthToken(authToken);
          dispatch(setUserData(safeUser));
        } else if (res.status === 401) {
          clearTabAuthToken();
          dispatch(setUserData(null));
        } else {
          dispatch(setUserData(null));
        }
      } catch {
        clearTabAuthToken({ persistent: false });
        dispatch(setUserData(null));
      } finally {
        dispatch(authChecked()); // 🔥 ALWAYS mark auth checked
        setLoading(false);
      }
    };

    fetchUser();
  }, [dispatch]);

  return loading;
};

export default useGetCurrentUser;
