import React, { useState, useEffect, useRef } from 'react'
import { AsciiBuilderLogo } from './home/AsciiBuilderLogo'
import { getEntryLogoPositionStyles } from '../constants/layout'

interface EntryAnimationProps {
  children: React.ReactNode
  isLoading: boolean
}

export const EntryAnimation: React.FC<EntryAnimationProps> = ({ children, isLoading }) => {
  const [animationPhase, setAnimationPhase] = useState<'logo-animating' | 'content-entering' | 'complete'>('logo-animating')
  const [showLogo, setShowLogo] = useState(true)
  const logoContainerRef = useRef<HTMLDivElement>(null)
  const hasStartedRef = useRef(false)
  
  useEffect(() => {
    if (!isLoading && !hasStartedRef.current) {
      hasStartedRef.current = true
      
      // Logo animation takes approximately 2.5s
      // fallDurationMs (600) + settleDurationMs (900) + cameraDollyMs (900) = ~2400ms
      const logoAnimationTimer = setTimeout(() => {
        setAnimationPhase('content-entering')
        
        // After content slides in, mark as complete
        setTimeout(() => {
          setAnimationPhase('complete')
          // Hide the logo overlay once everything is loaded
          setTimeout(() => {
            setShowLogo(false)
          }, 300)
        }, 600)
      }, 2400)
      
      return () => clearTimeout(logoAnimationTimer)
    }
  }, [isLoading])
  
  
  return (
    <>
      {/* Logo Overlay - Positioned precisely using layout constants */}
      {showLogo && (
        <div 
          className="fixed inset-0 bg-slate-950 z-50"
          style={{
            pointerEvents: 'none',
            transition: 'opacity 300ms ease-out',
            opacity: animationPhase === 'complete' ? 0 : 1
          }}
        >
          {/* Logo positioned at exact same location as HomeScreen */}
          <div 
            ref={logoContainerRef}
            style={{
              ...getEntryLogoPositionStyles(),
              zIndex: 20
            }}
          >
            <div className="inline-flex items-center gap-3">
              <AsciiBuilderLogo 
                colorClassName="text-cyan-400"
                idleMode={animationPhase === 'complete' ? 'still' : 'artifact'}
                // Keep animation settings consistent with original
                fallDurationMs={600}
                settleDurationMs={900}
                groupGapMs={140}
                cameraDollyMs={900}
                shakeIntensity={0.6}
              />
            </div>
          </div>
          
        </div>
      )}
      
      {/* Main App Content - Fades in underneath with precise timing */}
      <div 
        className={`
          h-screen w-screen
          transition-opacity duration-600 ease-out
          ${animationPhase === 'content-entering' || animationPhase === 'complete' ? 'opacity-100' : 'opacity-0'}
        `}
        style={{
          transitionDelay: animationPhase === 'content-entering' ? '100ms' : '0ms'
        }}
      >
        {children}
      </div>
    </>
  )
}