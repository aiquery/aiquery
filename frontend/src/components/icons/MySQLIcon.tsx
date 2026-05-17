import React from 'react'

const MySQLIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/MySQL.png" 
      alt="MySQL" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default MySQLIcon
