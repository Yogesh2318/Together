import express from 'express';
import protectedRoute from '../middleware/protectedRoutes.js';
import { Router } from 'express';
import { getFriends,getuser } from '../controllers/user.controller.js';

const router = Router();

router.get('/getfriends',protectedRoute,getFriends);
router.get('/user',protectedRoute,getuser);

export default router;