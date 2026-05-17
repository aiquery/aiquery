import React from 'react'

const BigQueryIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/Bigquery.png" 
      alt="Google BigQuery" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default BigQueryIcon
