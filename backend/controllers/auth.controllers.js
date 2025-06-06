
import bcrypt from "bcryptjs";
import User from "../modules/user.module.js";
import generateTokenAndSetCookie from "../utils/generateToken.js";

export const signup = async (req, res) => {
    try{
   const{username,email,password} = req.body;
    // Check if the user already exists
    if(await User.findOne({ username })){
        res.status(409).send("User already exists");
        return;
    }
    if(await User.findOne({ email })){
        res.status(409).send("Email already exists");
        return; 
    }
    
     const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password,salt);
    // Create a new user
  const newUser = new User({
    username,
    email,
    password: hashedPassword
    });
    // Save the user to the database

      await newUser.save();
    const token =  generateTokenAndSetCookie(newUser._id,res);

      res.status(201).json({
        _id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        token
    });
 

  
}
catch(error){
        console.log("Error in signup controller:", error.message);
        res.status(500).json({ error: "Internal server error signinup" });
    }

}

export const login = async (req,res)=>{
    try {
      const{username,password}= req.body;
      const loginUser = await User.findOne({username});
   
       const isPasswordCorrect = await bcrypt.compare(password,loginUser?.password||""); 
           if(!loginUser || !isPasswordCorrect ){
            return res.status(400).json({error:"Invalid credentails"});
           }
         const token = generateTokenAndSetCookie(loginUser._id,res);
          
          
          res.status(201).json({
            _id: loginUser._id,
            username: loginUser.username,
            email: loginUser.email,
            token
         
         });
    }
     catch (error) {
      
   
      console.log("Error in login controller:", error.message);
      res.status(500).json({ error: "Internal server error" });
     
    } 
    }

export const logout = (req, res) => {
  res.cookie("jwt","",{maxAge:0})
  res.status(200).json({message:"logged out sucessfully"})
   

}
