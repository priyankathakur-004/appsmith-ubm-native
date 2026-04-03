export default {

  // -----------------------------
  // Login function
  // -----------------------------
  signIn: async () => {
    try {
      // 1. Query user by email
      const [user] = await findUserByEmail.run();

      if (!user) {
        return showAlert("Invalid email/password combination", "error");
      }

      // 2. Verify password (using bcrypt)
      // const isValid = dcodeIO.bcrypt.compareSync(inp_password.text, user.password);
			const isValid = (inp_password.text === user.password);


      if (!isValid) {
        return showAlert("Invalid email/password combination", "error");
      }

      // 3. Store login state
      await storeValue("isLoggedIn", true);
      await storeValue("user", user);

      // 4. Success alert & navigate to Dashboard
      showAlert("Login Successful", "success");
      navigateTo("Dashboard");

    } catch (e) {
      console.error("Sign-in error:", e);
      showAlert("Something went wrong", "error");
    }
  },
	
	checkLoginPage: () => {
    // If token exists, redirect to Dashboard
    if (appsmith.store.isLoggedIn) {
      navigateTo("Dashboard");
    }
  },
};
