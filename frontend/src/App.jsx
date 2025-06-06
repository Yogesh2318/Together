import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import Home from "./page/Home/Home"
import Login from "./page/Login/Login"
import Signup from "./page/Signup/Signup"
import Friends from "./components/Friends"
import Requests from "./components/Requests"
import Meeting from './page/Meeting/Meeting'
import CallManager from './wrapper/CallManager'
import { Routes,Route } from "react-router-dom"
import { useAuthContext } from "./context/AuthContext"
import { Navigate } from "react-router-dom"
import './App.css'

function App() {

  const {authUser}=useAuthContext();

  return (
    <>
    <CallManager>
          <Routes>
      <Route path='/' element={authUser?<Home/>:<Navigate to="/signup"/>}/>
    <Route path='/login' element={authUser?<Navigate to="/"/>:<Login/>}/>
    <Route path='/signup' element={authUser?<Navigate to="/"/>:<Signup/>}/>
    <Route path='/friends' element={authUser?<Friends/>:<Navigate to="/login"/>}/>
    <Route path='/requests' element={authUser?<Requests/>:<Navigate to ="/login"/>} />
    <Route path='/meeting/:meetingId' element={authUser?<Meeting/>:<Navigate to = "/login"/>} />
      </Routes>
    </CallManager>
    </>
  )
}

export default App
