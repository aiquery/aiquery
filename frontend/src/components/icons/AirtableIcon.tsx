import React from 'react'

const AirtableIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <img 
      src="/images/AirTable.png" 
      alt="Airtable" 
      width={size} 
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}

export default AirtableIcon
