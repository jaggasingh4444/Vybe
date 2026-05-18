import React from 'react'
import LeftHome from '../components/LeftHome'
import Feed from '../components/Feed'
import RightHome from '../components/RightHome'

function Home() {
  return (
    <div className='w-full min-h-screen bg-black flex justify-center items-start'>
     <LeftHome/>
     <Feed/>
     <RightHome/>
    </div>
  )
}

export default Home
