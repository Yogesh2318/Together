import jwt from "jsonwebtoken"
import User from "../modules/user.module.js";

const protectRoute = async (req, res, next) => {
   try {
       const token = req.cookies.jwt;
       if (!token) {
           return res.status(401).json({error: "not authorized"});
       }

       const decode = jwt.verify(token, process.env.JWT_SECRET);
       console.log("Decoded Token:", decode);

       if (!decode) {
           return res.status(401).json({error: "invalid token"});
       }

       const user = await User.findById(decode.userId).select("-password");
     console.log("User:", user);
       if (!user) {
           return res.status(401).json({error: "user not found"});
       }

       req.user = user;
       next();

   } catch (error) {
       console.error("Error in middleware:", error);
       res.status(500).json({error: "internal server error"});
   }
};

export default protectRoute;
