import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  userData: null,
  suggestedUsers: [],
  isAuthChecked: false,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    setUserData: (state, action) => {
      state.userData = action.payload;
    },

    setSuggestedUsers: (state, action) => {
      state.suggestedUsers = action.payload;
    },

    authChecked: (state) => {
      state.isAuthChecked = true;
    },

    logout: (state) => {
      state.userData = null;
      state.suggestedUsers = [];
      state.isAuthChecked = true; // important
    },
  },
});

export const {
  setUserData,
  setSuggestedUsers,
  authChecked,
  logout,
} = userSlice.actions;

export default userSlice.reducer;
