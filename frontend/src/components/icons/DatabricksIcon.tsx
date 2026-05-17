import React from 'react'

const DatabricksIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/DataBricks.png" 
      alt="Databricks" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default DatabricksIcon
