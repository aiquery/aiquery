import React from 'react'

const AzureSQLIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/AzureSQL.png" 
      alt="Azure SQL" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default AzureSQLIcon
