import React from 'react'

const RedshiftIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/Redshift.png" 
      alt="AWS Redshift" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default RedshiftIcon
