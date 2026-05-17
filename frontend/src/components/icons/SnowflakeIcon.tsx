import React from 'react'

const SnowflakeIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/Snowflake.png" 
      alt="Snowflake" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default SnowflakeIcon
