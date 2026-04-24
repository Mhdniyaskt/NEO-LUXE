import asyncHandler from "../../utils/asyncHandler.util.js";

export const getAbout = asyncHandler(async (req, res) => {
    res.render('user/about', { layout: 'layouts/user' });
});