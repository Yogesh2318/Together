import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
const connectToMongoDB = async () => {
    try {
    
        await mongoose.connect(process.env.MONGO_URL||"mongodb+srv://yvbhivasane:YXviYAYUiJgX33Im@cluster0.hbecw.mongodb.net/Together?retryWrites=true&w=majority&appName=Cluster0")
        console.log("connected to MONGO-DB");
    } catch (error) {
        console.log("Error connecting  to MongoDB ",error.message)

    }
};

export default connectToMongoDB;