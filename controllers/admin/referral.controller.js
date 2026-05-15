import asyncHandler from '../../utils/asyncHandler.util.js';
import { getAllReferralsAdmin } from '../../services/referral.service.js';

// ─── GET /admin/referrals ─────────────────────────────────────────────────────
export const getAdminReferrals = asyncHandler(async (req, res) => {
  const { page = 1, search = '' } = req.query;

  const result = await getAllReferralsAdmin(parseInt(page), 15, search);

  res.render('admin/referrals', {
    layout: 'layouts/admin',
    path:   'referrals',
    ...result,
    search,
  });
});
