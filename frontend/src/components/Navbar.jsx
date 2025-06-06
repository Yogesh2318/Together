import React from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'

function Navbar() {
    const navigate = useNavigate();
    const tonavigate = () => {
        navigate('/friends')
    }
    const nav = ()=>{
        navigate('/requests')
    }
return (
    <div className="flex justify-between p-1 bg-white text-black h-15 sticky top-0">
        <div className='p-4 '>Together</div>
        <div className="flex gap-4">
            <div className="p-2 ">Home</div>
            <div className="p-2" onClick={tonavigate} >friends</div>
            <div className="p-2 " onClick={nav}>Request</div>
        </div>
    </div>
)
}

export default Navbar