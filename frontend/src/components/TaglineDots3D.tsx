import React, { useRef, useMemo, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const TAGLINE_COLORS = [
  '#667eea',
  '#764ba2',
  '#38bdf8',
  '#10b981',
  '#f59e0b',
  '#ec4899',
]

const TaglineFloatingDots: React.FC = () => {
  const groupRef = useRef<THREE.Group>(null)
  const dotCount = 6
  const dots = useMemo(() => {
    return Array.from({ length: dotCount }).map((_, i) => ({
      id: i,
      color: TAGLINE_COLORS[i % TAGLINE_COLORS.length],
      baseX: (Math.random() - 0.5) * 16,
      baseY: (Math.random() - 0.5) * 8,
      baseZ: (Math.random() - 0.5) * 6 - 4,
      radius: 1.5 + Math.random() * 2,
      speed: 0.25 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      scale: 0.06 + Math.random() * 0.04,
    }))
  }, [])

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime
    dots.forEach((dot, i) => {
      const mesh = groupRef.current!.children[i] as THREE.Mesh
      if (!mesh) return
      const angle = t * dot.speed + dot.phase
      const x = dot.baseX + Math.cos(angle) * dot.radius
      const y = dot.baseY + Math.sin(angle * 0.7) * dot.radius * 0.8
      const z = dot.baseZ + Math.sin(angle * 0.5) * 1.5
      mesh.position.set(x, y, z)
      const pulse = 1 + Math.sin(t * 1.2 + dot.phase) * 0.2
      mesh.scale.setScalar(dot.scale * pulse)
    })
  })

  return (
    <group ref={groupRef}>
      {dots.map((dot) => (
        <mesh key={dot.id} position={[dot.baseX, dot.baseY, dot.baseZ]} scale={dot.scale}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshStandardMaterial
            color={dot.color}
            emissive={dot.color}
            emissiveIntensity={0.55}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}
    </group>
  )
}

const TaglineDots3D: React.FC = () => {
  const [hasError, setHasError] = React.useState(false)

  React.useEffect(() => {
    const handler = () => setHasError(true)
    window.addEventListener('error', handler)
    return () => window.removeEventListener('error', handler)
  }, [])

  if (hasError) return null

  return (
    <div className="tagline-dots3d-container">
      <Suspense fallback={null}>
        <Canvas
          camera={{ position: [0, 0, 12], fov: 55 }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          onError={() => setHasError(true)}
          gl={{ alpha: true, antialias: true }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.6} />
          <pointLight position={[8, 8, 8]} intensity={0.7} />
          <TaglineFloatingDots />
        </Canvas>
      </Suspense>
    </div>
  )
}

export default TaglineDots3D
