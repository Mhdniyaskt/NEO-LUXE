export const googleCallback = (req, res) => {
  try {
    const user = req.user;

    console.log(user);

    // Save user in session
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
    };

    res.redirect("/");
  } catch (error) {
    console.error("Google Login Error:", error);
    res.redirect("/login");
  }
};