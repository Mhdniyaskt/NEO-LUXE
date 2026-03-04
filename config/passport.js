import dotenv from "dotenv";
dotenv.config();
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.model.js";

passport.use(
    new GoogleStrategy(
        {
            clientID:process.env.GOOGLE_CLIENT_ID,
            clientSecret:process.env.GOOGLE_CLIENT_SECRET,
            callbackURL:"/auth/google/callback"
        },

        async (accessToken, refreshToken, profile, done)=>{
            try{
                const email = profile.emails[0]?.value;

                if(!email){
                    return done(null,false,{
                        message:"Google account does not have an email"
                    });
                }

                let user = await User.findOne({email});

                if(user && user.isBlocked){
                    return done(null,false,{
                        message:"Your account is blocked"
                    }); 
                }

                if(user.role === "admin"){
                    return done(null,false,{
                        message:"Access Denied.Use Admin Login"
                    }); 
                }

                if(user && !user.googleId){
                    user.googleId = profile.id;
                    user.isVerified = true;
                    await user.save();

                    return done(null,user);

                }


                if(!user){
                    user = await User.create({
                        name:profile.displayName,
                        email,
                        googleId:profile.id,
                        isVerified:true
                    });
                }
                return done(null,user);

            }catch(error){
                return done(error,null);

            }
        }
        
    )
);

export default passport;