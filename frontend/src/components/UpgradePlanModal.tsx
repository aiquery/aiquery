import React from 'react'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import PricingPlans from './PricingPlans'
import './UpgradePlanModal.css'

interface UpgradePlanModalProps {
  onClose: () => void
  inline?: boolean
}

const UpgradePlanModal: React.FC<UpgradePlanModalProps> = ({ onClose, inline = false }) => {
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } =
    useDraggableResizable({
      initialWidth: 1200,
      initialHeight: 700,
      minWidth: 800,
      minHeight: 500,
      storageKey: 'upgradePlanModal',
    })

  const modalContent = (
    <div className="upgrade-plan-modal-content upgrade-plan-modal-content--pricing-plans">
      <PricingPlans embedded onClose={onClose} />
    </div>
  )

  if (inline) {
    return (
      <div className="upgrade-plan-panel">
        <div className="upgrade-plan-panel-header">
          <h2>Upgrade Plan</h2>
          <button className="upgrade-plan-panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {modalContent}
      </div>
    )
  }

  return (
    <div className="upgrade-plan-modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="upgrade-plan-modal draggable-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${modalSize.width}px`,
          height: `${modalSize.height}px`,
          cursor: isDragging ? 'grabbing' : 'default',
        }}
      >
        <div
          className="upgrade-plan-modal-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'grab' }}
        >
          <h2>Upgrade Plan</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {modalContent}
        <div className="resize-handle" onMouseDown={handleResizeStart} />
      </div>
    </div>
  )
}

export default UpgradePlanModal
