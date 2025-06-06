import { Router } from "express";
import { addFriend, getFriends, removeFriend,getRequest } from "../controllers/friend.controllers.js";
import protectRoute from "../middleware/protectedRoutes.js";
const router = Router();

router.get("/accept-request/:id", protectRoute, getFriends);
router.post("/send-request/:id",protectRoute,addFriend);
router.get("/remove-request/:id", protectRoute,removeFriend);
router.get("/request",protectRoute,getRequest);
export default router;
