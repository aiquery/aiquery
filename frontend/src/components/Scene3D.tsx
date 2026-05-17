import React, { useRef, useMemo, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Glittering Stars - Background starfield
const StarField: React.FC = () => {
  const starsRef = useRef<THREE.Group>(null)
  const starCount = 3000

  const stars = useMemo(() => {
    return Array.from({ length: starCount }).map((_, i) => {
      // Random positions in a sphere
      const radius = 25 + Math.random() * 15
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 2 - 1)
      
      const x = radius * Math.sin(phi) * Math.cos(theta)
      const y = radius * Math.sin(phi) * Math.sin(theta)
      const z = radius * Math.cos(phi)

      // Bright white to slightly blue-white stars for glittering effect
      const brightness = 0.7 + Math.random() * 0.3
      const color = new THREE.Color(brightness, brightness, 0.9 + Math.random() * 0.1)

      // Vary star sizes for depth
      const scale = Math.random() * 0.03 + 0.01

      // Twinkling effect (random phase)
      const twinklePhase = Math.random() * Math.PI * 2

      return {
        id: i,
        position: new THREE.Vector3(x, y, z),
        color,
        scale,
        twinklePhase,
      }
    })
  }, [])

  useFrame((state) => {
    if (starsRef.current) {
      stars.forEach((star, index) => {
        const mesh = starsRef.current?.children[index] as THREE.Mesh | undefined
        if (mesh) {
          // Twinkling effect
          const twinkle = 0.7 + Math.sin(state.clock.elapsedTime * 2 + star.twinklePhase) * 0.3
          const material = mesh.material as THREE.MeshStandardMaterial
          material.emissiveIntensity = twinkle * 0.8
          material.opacity = 0.6 + twinkle * 0.4
        }
      })
    }
  })

  return (
    <group ref={starsRef}>
      {stars.map((star) => (
        <mesh
          key={star.id}
          position={star.position}
          scale={[star.scale, star.scale, star.scale]}
        >
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial
            color={star.color}
            transparent
            opacity={0.8}
            emissive={star.color}
            emissiveIntensity={0.7}
          />
        </mesh>
      ))}
    </group>
  )
}

// Milky Way Galaxy - Dense band of glittering stars
const MilkyWay: React.FC = () => {
  const starsRef = useRef<THREE.Group>(null)
  const count = 100 // Dense cluster of stars for Milky Way band

  const stars = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      // Create a band-like distribution (Milky Way appears as a band across the sky)
      // Horizontal band with some vertical spread
      const bandWidth = 20 // Width of the Milky Way band
      const bandHeight = 3 // Thickness of the band
      
      // Position stars in a band that curves slightly
      const x = (Math.random() - 0.5) * bandWidth
      const y = (Math.random() - 0.5) * bandHeight + Math.sin(x * 0.2) * 2 // Slight curve
      const z = (Math.random() - 0.5) * 15 - 5 // Depth variation, slightly forward

      // Bright white to subtle blue-white stars (like the image)
      const brightness = 0.75 + Math.random() * 0.25
      const blueTint = Math.random() < 0.3 ? 0.05 : 0 // Some stars have slight blue tint
      const color = new THREE.Color(
        brightness,
        brightness,
        0.9 + Math.random() * 0.1 + blueTint
      )

      // Vary star sizes - some larger, some smaller
      const scale = Math.random() * 0.04 + 0.015

      // Twinkling effect (random phase for each star)
      const twinklePhase = Math.random() * Math.PI * 2
      const twinkleSpeed = 1.5 + Math.random() * 1.5 // Vary twinkling speed

      return {
        id: i,
        position: new THREE.Vector3(x, y, z),
        color,
        scale,
        twinklePhase,
        twinkleSpeed,
      }
    })
  }, [])

  useFrame((state) => {
    if (starsRef.current) {
      stars.forEach((star, index) => {
        const mesh = starsRef.current?.children[index] as THREE.Mesh | undefined
        if (mesh) {
          // Glittering/twinkling effect - more pronounced than background stars
          const twinkle = 0.6 + Math.sin(state.clock.elapsedTime * star.twinkleSpeed + star.twinklePhase) * 0.4
          const material = mesh.material as THREE.MeshStandardMaterial
          material.emissiveIntensity = twinkle * 0.9
          material.opacity = 0.7 + twinkle * 0.3
        }
      })
    }
  })

  return (
    <group ref={starsRef}>
      {stars.map((star) => (
        <mesh
          key={star.id}
          position={star.position}
          scale={[star.scale, star.scale, star.scale]}
        >
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial
            color={star.color}
            transparent
            opacity={0.9}
            emissive={star.color}
            emissiveIntensity={0.8}
          />
        </mesh>
      ))}
    </group>
  )
}

// Colorful floating orbs - running/drifting items (antigravity-style)
const COLORS = [
  '#667eea', // purple-blue
  '#764ba2', // purple
  '#38bdf8', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#8b5cf6', // violet
]
const ColorfulFloatingOrbs: React.FC = () => {
  const groupRef = useRef<THREE.Group>(null)
  const orbCount = 14
  const orbs = useMemo(() => {
    return Array.from({ length: orbCount }).map((_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      baseX: (Math.random() - 0.5) * 24,
      baseY: (Math.random() - 0.5) * 14,
      baseZ: (Math.random() - 0.5) * 10 - 5,
      radius: 2.5 + Math.random() * 3,
      speed: 0.3 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      scale: 0.08 + Math.random() * 0.06,
    }))
  }, [])

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime
    orbs.forEach((orb, i) => {
      const mesh = groupRef.current!.children[i] as THREE.Mesh
      if (!mesh) return
      // Orbit / drift in a loop - "running" motion
      const angle = t * orb.speed + orb.phase
      const x = orb.baseX + Math.cos(angle) * orb.radius
      const y = orb.baseY + Math.sin(angle * 0.7) * orb.radius * 0.8
      const z = orb.baseZ + Math.sin(angle * 0.5) * 2
      mesh.position.set(x, y, z)
      // Subtle scale pulse
      const pulse = 1 + Math.sin(t * 1.2 + orb.phase) * 0.15
      const s = orb.scale * pulse
      mesh.scale.setScalar(s)
    })
  })

  return (
    <group ref={groupRef}>
      {orbs.map((orb) => (
        <mesh key={orb.id} position={[orb.baseX, orb.baseY, orb.baseZ]} scale={orb.scale}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshStandardMaterial
            color={orb.color}
            emissive={orb.color}
            emissiveIntensity={0.6}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}
    </group>
  )
}

// Shooting Stars - Enhanced visibility
const ShootingStars: React.FC = () => {
  const starsRef = useRef<THREE.Group>(null)
  const starCount = 12 // More shooting stars

  const stars = useMemo(() => {
    return Array.from({ length: starCount }).map((_, i) => ({
      id: i,
      startX: (Math.random() - 0.5) * 35,
      startY: (Math.random() - 0.5) * 35,
      startZ: (Math.random() - 0.5) * 35,
      speed: 0.6 + Math.random() * 0.6,
      delay: Math.random() * 8,
      length: 3 + Math.random() * 4,
    }))
  }, [])

  useFrame((state) => {
    if (starsRef.current) {
      stars.forEach((star, index) => {
        const child = starsRef.current?.children[index] as THREE.Line | undefined
        if (child) {
          const time = (state.clock.elapsedTime + star.delay) % 12
          const progress = (time / 6) % 1
          
          // Shooting star moves from one side to another
          const direction = new THREE.Vector3(
            star.startX > 0 ? -1 : 1,
            star.startY > 0 ? -0.6 : 0.6,
            star.startZ > 0 ? -0.4 : 0.4
          ).normalize()

          const currentPos = new THREE.Vector3(
            star.startX + direction.x * progress * 50,
            star.startY + direction.y * progress * 50,
            star.startZ + direction.z * progress * 50
          )

          const trailDirection = direction.clone().multiplyScalar(-star.length)
          const trailEnd = currentPos.clone().add(trailDirection)

          const positions = new Float32Array([
            currentPos.x, currentPos.y, currentPos.z,
            trailEnd.x, trailEnd.y, trailEnd.z
          ])

          child.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
          
          // Enhanced fade in/out with brighter peak
          const opacity = progress < 0.15 
            ? progress * 6.67 
            : progress > 0.85 
            ? (1 - progress) * 6.67 
            : 1
          ;(child.material as THREE.LineBasicMaterial).opacity = opacity * 0.9
        }
      })
    }
  })

  return (
    <group ref={starsRef}>
      {stars.map((star) => {
        const positions = new Float32Array([0, 0, 0, 0, 0, 0])
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

        return (
          <line key={star.id} geometry={geometry}>
            <lineBasicMaterial
              color="#ffffff"
              transparent
              opacity={0}
              linewidth={3}
            />
          </line>
        )
      })}
    </group>
  )
}

const Scene3D: React.FC = () => {
  const [hasError, setHasError] = React.useState(false)

  React.useEffect(() => {
    const errorHandler = () => setHasError(true)
    window.addEventListener('error', errorHandler)
    return () => window.removeEventListener('error', errorHandler)
  }, [])

  if (hasError) {
    return (
      <div style={{ 
        width: '100%', 
        height: '100%', 
        background: '#000000' 
      }} />
    )
  }

  return (
    <div className="scene-3d-container">
      <Suspense fallback={
        <div style={{ 
          width: '100%', 
          height: '100%', 
          background: '#000000' 
        }} />
      }>
        <Canvas 
          camera={{ position: [0, 0, 15], fov: 60 }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0)
          }}
          onError={(error) => {
            console.error('Canvas error:', error)
            setHasError(true)
          }}
          gl={{ alpha: true, antialias: true }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={0.8} />
          <pointLight position={[-10, -5, 5]} intensity={0.3} color="#667eea" />
          <StarField />
          <MilkyWay />
          <ShootingStars />
          <ColorfulFloatingOrbs />
        </Canvas>
      </Suspense>
    </div>
  )
}

export default Scene3D
