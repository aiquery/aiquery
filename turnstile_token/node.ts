import { useState, useEffect, useRef, RefObject } from 'react'

interface UseResizableOptions {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  initialWidth?: number
  initialHeight?: number
}

export function useResizable(
  ref: RefObject<HTMLElement>,
  options: UseResizableOptions = {}
): {
  width: number
  height: number
  isResizing: boolean
} {
  const {
    minWidth = 300,
    minHeight = 200,
    maxWidth = window.innerWidth,
    maxHeight = window.innerHeight,
    initialWidth,
    initialHeight
  } = options

  const [width, setWidth] = useState(initialWidth || 900)
  const [height, setHeight] = useState(initialHeight || 600)
  const [isResizing, setIsResizing] = useState(false)
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  useEffect(() => {
    if (!ref.current) return

    const element = ref.current
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.classList.contains('resize-handle')) return

      e.preventDefault()
      setIsResizing(true)
      startPosRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: element.offsetWidth,
        height: element.offsetHeight
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return

      const deltaX = e.clientX - startPosRef.current.x
      const deltaY = e.clientY - startPosRef.current.y

      const newWidth = Math.max(minWidth, Math.min(maxWidth, startPosRef.current.width + deltaX))
      const newHeight = Math.max(minHeight, Math.min(maxHeight, startPosRef.current.height + deltaY))

      setWidth(newWidth)
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [ref, isResizing, minWidth, minHeight, maxWidth, maxHeight])

  return { width, height, isResizing }
}
