import { request } from "express";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    friends: {
        type: [String],
        default: []
    },
    requests: {
        type: [String],
        default: []
    }

});

const User = mongoose.model('User', userSchema);

export default User;
