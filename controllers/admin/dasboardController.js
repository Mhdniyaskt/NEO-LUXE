export const showAdminDashboard = (req,res)=>{
    return res.render("admin/dashboard",{ layout: "layouts/admin" ,path: '/admin/dashboard'});
}