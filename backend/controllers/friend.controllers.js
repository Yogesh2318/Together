import User from "../modules/user.module.js";

export const addFriend = async(req, res) => {
    const receiverId = req.params.id;
    const senderId = req.user._id;
     if(receiverId === senderId){
         return res.status(400).json({error:"you can't send request to yourself"});
     }
       try{
        const receiver = await User.findById(receiverId);
        const sender = await User.findById(senderId);
        if(!receiver || !sender){
            return res.status(400).json({error:"user not found addfriend"});
        }
        console.log("receiver",receiver);
        console.log("sender",sender);
        if(sender.friends.includes(receiverId)){
            return res.status(400).json({error:"you are already friends"});
        }
        if(sender.requests.includes(receiverId)){
            return res.status(400).json({error:"request already sent"});
        }
        if(receiver.requests.includes(senderId)){
            return res.status(400).json({error:"you have already received request"});
        }
        receiver.requests.push(senderId);
        await receiver.save();
        
        res.status(200).json({message:"request sent"});
        
       }catch(error){
           console.log("error in addFriend",error);
           res.status(500).json({error:"internal server error "});
       }
}

export const getFriends = async(req, res) => {
    const requested_id = req.params.id;
    const user = req.user._id;
    try{
      const accepter = await User.findById(user);
      const sender = await User.findById(requested_id);
        if(!accepter || !sender){
            return res.status(400).json({error:"user not found get friends"});
        }
        console.log("accepter",accepter);
        if(!accepter.requests.includes(requested_id)){
            return res.status(400).json({error:"you have not received request"});
        }
        if(accepter.friends.includes(requested_id)){
            return res.status(400).json({error:"you are already friends"});
        }
        accepter.friends.push(requested_id);
        sender.friends.push(user);
        accepter.requests = accepter.requests.filter(request => request !== requested_id);
        await accepter.save();
        await sender.save();
        res.status(200).json({message:"friend added"});

    }
    catch(error){
        console.log("error in getFriends",error);
        res.status(500).json({error:"internal server error getfriends"});
    }
}

export const removeFriend = async(req, res) => {
    const friendId = req.params.id;
    const user = req.user._id;
    try{
        const remover = await User.findById(user);
        const friend = await User.findById(friendId);
        if(!remover || !friend){
            return res.status(400).json({error:"user not found"});
        }
        if(!remover.friends.includes(friendId)){
            return res.status(400).json({error:"you are not friends"});
        }
        remover.friends = remover.friends.filter(friend => friend !== friendId);
        friend.friends = friend.friends.filter(friend => friend !== user);
        await remover.save();
        await friend.save();
        res.status(200).json({message:"friend removed"});
    }
    catch(error){
        console.log("error in removeFriend",error);
        res.status(500).json({error:"internal server error"});
    }
}

export  const  getRequest = async (req,res)=>{

    try {
        const id = req.user._id;
        const user = await User.findById(id);
        
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const request = await User.find({ _id: { $in: user.requests.map(f => f.toString()) } });
        res.status(200).json({ request });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
} 