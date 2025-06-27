import express from 'express';
import protectedRoute from '../middleware/protectedRoutes.js';
import { Router } from 'express';
import { getFriends,getuser,getusers } from '../controllers/user.controller.js';
import { get } from 'http';

const router = Router();

router.get('/getfriends',protectedRoute,getFriends);
router.get('/user',protectedRoute,getuser);
router.get('/users',protectedRoute,getusers);

export default router;