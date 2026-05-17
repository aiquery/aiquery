import React from 'react'

const PostgreSQLIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/PostgreSQL.png" 
      alt="PostgreSQL" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default PostgreSQLIcon
