import User from '../modules/user.module.js';

export const getFriends = async (req, res) => {
    try {
        const id = req.user._id;
        const user = await User.findById(id);
        
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const friends = await User.find({ _id: { $in: user.friends.map(f => f.toString()) } });
        res.status(200).json({ friends });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};


export const getuser = async (req, res) => {
   
    try {
        const username = req.body;
        const user = await User.findOne(username);
        res.json(user);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
}
export const getusers = async (req, res) => {
    try {
        const users = await User.find({});
        const fileteredUsers = users.filter(user => user._id.toString() !== req.user._id.toString());
        console.log(fileteredUsers);
        res.json(users);
    }
    catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: error.message });

    }
};
// Compare this snippet from backend/controllers/auth.controllers.js: