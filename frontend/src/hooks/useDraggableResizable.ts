import { useState, useRef, useEffect } from 'react'

interface UseDraggableResizableOptions {
  initialWidth?: number
  initialHeight?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  storageKey?: string
}

export const useDraggableResizable = (options: UseDraggableResizableOptions = {}) => {
  const {
    initialWidth = 800,
    initialHeight = 600,
    minWidth = 400,
    minHeight = 300,
    maxWidth = window.innerWidth - 40,
    maxHeight = window.innerHeight - 40,
    storageKey
  } = options

  const modalRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [position, setPosition] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`modal_position_${storageKey}`)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          return { x: parsed.x || 0, y: parsed.y || 0 }
        } catch (e) {
          console.error('Error parsing saved position:', e)
        }
      }
    }
    return { x: 0, y: 0 }
  })
  const [modalSize, setModalSize] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`modal_size_${storageKey}`)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          return {
            width: parsed.width || initialWidth,
            height: parsed.height || initialHeight
          }
        } catch (e) {
          console.error('Error parsing saved size:', e)
        }
      }
    }
    return { width: initialWidth, height: initialHeight }
  })
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  // Save position and size to localStorage
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`modal_position_${storageKey}`, JSON.stringify(position))
      localStorage.setItem(`modal_size_${storageKey}`, JSON.stringify(modalSize))
    }
  }, [position, modalSize, storageKey])

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!modalRef.current) return
    
    const rect = modalRef.current.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
    setIsDragging(true)
  }

  // Handle resize start
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!modalRef.current) return
    
    const rect = modalRef.current.getBoundingClientRect()
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height
    }
    setIsResizing(true)
  }

  // Handle mouse move for dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && modalRef.current) {
        const newX = e.clientX - dragOffset.x
        const newY = e.clientY - dragOffset.y
        
        // Keep modal within viewport
        const maxX = window.innerWidth - modalSize.width
        const maxY = window.innerHeight - modalSize.height
        
        setPosition({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY))
        })
      } else if (isResizing && modalRef.current) {
        const deltaX = e.clientX - resizeStartRef.current.x
        const deltaY = e.clientY - resizeStartRef.current.y
        
        const newWidth = Math.max(minWidth, Math.min(resizeStartRef.current.width + deltaX, maxWidth))
        const newHeight = Math.max(minHeight, Math.min(resizeStartRef.current.height + deltaY, maxHeight))
        
        setModalSize({ width: newWidth, height: newHeight })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = isDragging ? 'grabbing' : (isResizing ? 'nwse-resize' : '')
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, isResizing, dragOffset, modalSize, minWidth, minHeight, maxWidth, maxHeight])

  return {
    modalRef,
    position,
    modalSize,
    isDragging,
    isResizing,
    handleMouseDown,
    handleResizeStart
  }
}
