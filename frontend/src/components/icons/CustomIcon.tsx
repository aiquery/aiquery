import React from 'react'

const CustomIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Custom/Generic Data Source Icon - Gear with Database */}
      <circle cx="12" cy="12" r="10" fill="#6366F1" fillOpacity="0.9"/>
      {/* Database cylinder */}
      <ellipse cx="12" cy="9" rx="4" ry="1.5" fill="white" fillOpacity="0.95"/>
      <rect x="8" y="9" width="8" height="6" fill="white" fillOpacity="0.95"/>
      <ellipse cx="12" cy="15" rx="4" ry="1.5" fill="white" fillOpacity="0.85"/>
      <line x1="8" y1="11" x2="16" y2="11" stroke="#6366F1" strokeWidth="0.8"/>
      <line x1="8" y1="13" x2="16" y2="13" stroke="#6366F1" strokeWidth="0.8"/>
      {/* Gear icon overlay */}
      <circle cx="12" cy="12" r="2.5" fill="white" fillOpacity="0.9"/>
      <circle cx="12" cy="12" r="1.5" fill="#6366F1"/>
    </svg>
  )
}

export default CustomIcon
